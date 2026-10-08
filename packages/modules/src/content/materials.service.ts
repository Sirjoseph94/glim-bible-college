import type { Announcement, Material } from "@glim/contracts";
import { Db, schema } from "@glim/db";
import { AuthorizationService } from "@glim/modules/authorization";
import { NotificationsService } from "@glim/modules/notifications";
import {
  CLOCK,
  definedFields,
  domainError,
  err,
  ok,
  type Clock,
  type DomainError,
  type DomainResult,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, isNull, lte, max, ne, or, sql, type SQL } from "drizzle-orm";
import { FilesService } from "./files.service";
import { renderMarkdown } from "./markdown";

type MaterialRow = typeof schema.courseMaterials.$inferSelect;
type FileRow = typeof schema.files.$inferSelect;
type AnnouncementRow = typeof schema.announcements.$inferSelect;

interface CommonFields {
  title: string;
  sectionLabel?: string | null | undefined;
  visibility?: "ENROLLED" | "STAFF_ONLY" | undefined;
  publishAt?: string | null | undefined;
  status?: "DRAFT" | "PUBLISHED" | undefined;
}

export type NewMaterial =
  | (CommonFields & { kind: "FILE"; fileId: string })
  | (CommonFields & { kind: "LINK"; url: string })
  | (CommonFields & { kind: "TEXT"; bodyMd: string });

export interface MaterialChange {
  title?: string | undefined;
  sectionLabel?: string | null | undefined;
  url?: string | undefined;
  bodyMd?: string | undefined;
  visibility?: "ENROLLED" | "STAFF_ONLY" | undefined;
  publishAt?: string | null | undefined;
  position?: number | undefined;
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED" | undefined;
}

export interface NewAnnouncement {
  title: string;
  bodyMd: string;
  pinned?: boolean | undefined;
  classMeetingId?: string | null | undefined;
}

export interface AnnouncementChange {
  title?: string | undefined;
  bodyMd?: string | undefined;
  pinned?: boolean | undefined;
}

const notFound = () => err(domainError("NOT_FOUND", "Not found."));
const invalid = (path: string, message: string): DomainError =>
  domainError("VALIDATION_FAILED", message, {
    fieldErrors: [{ path, code: "invalid", message }],
  });
const stale = () =>
  err(domainError("VERSION_MISMATCH", "Someone else changed this. Reload and try again."));
const toDate = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(value);

/**
 * A course's materials and announcements (owner: content, TRD §14.1). Students whose course
 * enrollment is ENROLLED or COMPLETED (while studying) read them; the course's Primary,
 * Co-lecturers and Assistants and the academic admins manage them.
 */
@Injectable()
export class MaterialsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  // ---- materials ----

  /** Managers see every material that isn't archived; others published, released ones. */
  async list(offeringId: string, viewerUserId: string): Promise<Material[]> {
    const manages = await this.manages(viewerUserId, offeringId);
    const m = schema.courseMaterials;
    const rows = await this.db.read
      .select({ material: m, file: schema.files })
      .from(m)
      .leftJoin(schema.files, eq(schema.files.id, m.fileId))
      .where(and(eq(m.courseOfferingId, offeringId), this.visible(manages)))
      .orderBy(sql`${m.sectionLabel} ASC NULLS FIRST`, asc(m.position), asc(m.createdAt));
    return rows.map((r) => toMaterial(r.material, r.file));
  }

  async create(
    offeringId: string,
    input: NewMaterial,
    actorUserId: string,
  ): Promise<DomainResult<Material>> {
    const result = await this.db.withTxResult(async ({ db }) => {
      if (
        input.kind === "FILE" &&
        !(await this.files.isUsable(input.fileId, actorUserId, "MATERIAL", db))
      )
        return err(invalid("body.fileId", "Upload the file first, then add it."));
      const m = schema.courseMaterials;
      const [last] = await db
        .select({ position: max(m.position) })
        .from(m)
        .where(eq(m.courseOfferingId, offeringId));
      const now = this.clock.now();
      const [row] = await db
        .insert(m)
        .values({
          courseOfferingId: offeringId,
          sectionLabel: input.sectionLabel ?? null,
          title: input.title,
          kind: input.kind,
          fileId: input.kind === "FILE" ? input.fileId : null,
          url: input.kind === "LINK" ? input.url : null,
          bodyMd: input.kind === "TEXT" ? input.bodyMd : null,
          visibility: input.visibility ?? "ENROLLED",
          publishAt: toDate(input.publishAt) ?? null,
          position: (last?.position ?? -1) + 1,
          status: input.status ?? "PUBLISHED",
          createdBy: actorUserId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (row === undefined) throw new Error("material insert returned nothing");
      return ok(row.id);
    });
    return result.ok ? ok(await this.material(result.value)) : result;
  }

  async update(
    id: string,
    expectedVersion: number,
    change: MaterialChange,
  ): Promise<DomainResult<Material>> {
    const result = await this.db.withTxResult(async ({ db }) => {
      const m = schema.courseMaterials;
      const [row] = await db.select().from(m).where(eq(m.id, id)).for("update");
      if (row === undefined || row.status === "ARCHIVED") return notFound();
      if (row.version !== expectedVersion) return stale();
      if (change.url !== undefined && row.kind !== "LINK")
        return err(invalid("body.url", "Only a link has a URL."));
      if (change.bodyMd !== undefined && row.kind !== "TEXT")
        return err(invalid("body.bodyMd", "Only a text has a body."));
      await db
        .update(m)
        .set({
          ...definedFields({
            title: change.title,
            sectionLabel: change.sectionLabel,
            url: change.url,
            bodyMd: change.bodyMd,
            visibility: change.visibility,
            publishAt: toDate(change.publishAt),
            position: change.position,
            status: change.status,
          }),
          updatedAt: this.clock.now(),
          version: sql`${m.version} + 1`,
        })
        .where(eq(m.id, id));
      return ok(null);
    });
    return result.ok ? ok(await this.material(id)) : result;
  }

  /** Archives it: it leaves the course, and its file stays on record. */
  async remove(id: string): Promise<DomainResult<null>> {
    const m = schema.courseMaterials;
    const [row] = await this.db.withTx(({ db }) =>
      db
        .update(m)
        .set({ status: "ARCHIVED", updatedAt: this.clock.now(), version: sql`${m.version} + 1` })
        .where(and(eq(m.id, id), ne(m.status, "ARCHIVED")))
        .returning({ id: m.id }),
    );
    return row === undefined ? notFound() : ok(null);
  }

  /** A short-lived download URL for a FILE material the viewer can see; null otherwise. */
  async downloadUrl(id: string, viewerUserId: string): Promise<string | null> {
    const offeringId = await this.offeringOfMaterial(id);
    if (offeringId === null) return null;
    const manages = await this.manages(viewerUserId, offeringId);
    const m = schema.courseMaterials;
    const [row] = await this.db.read
      .select({ fileId: m.fileId })
      .from(m)
      .where(and(eq(m.id, id), this.visible(manages)));
    if (row?.fileId === undefined || row.fileId === null) return null;
    return (await this.files.presignedReadUrls([row.fileId])).get(row.fileId) ?? null;
  }

  async offeringOfMaterial(id: string): Promise<string | null> {
    const m = schema.courseMaterials;
    const [row] = await this.db.read
      .select({ offeringId: m.courseOfferingId })
      .from(m)
      .where(eq(m.id, id));
    return row?.offeringId ?? null;
  }

  // ---- announcements ----

  /** Pinned first, then newest. */
  async announcements(offeringId: string): Promise<Announcement[]> {
    const a = schema.announcements;
    const rows = await this.db.read
      .select({ announcement: a, authorName: schema.users.displayName })
      .from(a)
      .innerJoin(schema.users, eq(schema.users.id, a.authorUserId))
      .where(eq(a.courseOfferingId, offeringId))
      .orderBy(desc(a.pinned), desc(a.publishedAt), desc(a.id));
    return rows.map((r) => toAnnouncement(r.announcement, r.authorName));
  }

  /** Posts it now and tells the course's enrolled students in the app. */
  async announce(
    offeringId: string,
    input: NewAnnouncement,
    actorUserId: string,
  ): Promise<DomainResult<Announcement>> {
    const result = await this.db.withTxResult(async (tx) => {
      if (input.classMeetingId !== undefined && input.classMeetingId !== null) {
        const cm = schema.classMeetings;
        const [meeting] = await tx.db
          .select({ id: cm.id })
          .from(cm)
          .where(and(eq(cm.id, input.classMeetingId), eq(cm.courseOfferingId, offeringId)));
        if (meeting === undefined)
          return err(invalid("body.classMeetingId", "Choose a Class Meeting of this course."));
      }
      const now = this.clock.now();
      const a = schema.announcements;
      const [row] = await tx.db
        .insert(a)
        .values({
          courseOfferingId: offeringId,
          authorUserId: actorUserId,
          classMeetingId: input.classMeetingId ?? null,
          title: input.title,
          bodyMd: input.bodyMd,
          pinned: input.pinned ?? false,
          publishedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (row === undefined) throw new Error("announcement insert returned nothing");
      const course = await tx.db
        .select({ code: schema.courses.code })
        .from(schema.courseOfferings)
        .innerJoin(schema.courses, eq(schema.courses.id, schema.courseOfferings.courseId))
        .where(eq(schema.courseOfferings.id, offeringId));
      const ce = schema.courseEnrollments;
      const s = schema.students;
      const students = await tx.db
        .selectDistinct({ userId: s.userId })
        .from(ce)
        .innerJoin(s, eq(s.id, ce.studentId))
        .where(
          and(
            eq(ce.courseOfferingId, offeringId),
            eq(ce.status, "ENROLLED"),
            eq(s.status, "ACTIVE"),
          ),
        );
      for (const { userId } of students)
        await this.notifications.notify(tx, {
          userId,
          kind: "content.announcement",
          title: `${course[0]?.code ?? ""}: ${input.title}`,
          data: { offeringId, announcementId: row.id },
          email: false,
          dedupeKey: `announcement:${row.id}`,
        });
      return ok(row.id);
    });
    return result.ok ? ok(await this.announcement(result.value)) : result;
  }

  async updateAnnouncement(
    id: string,
    expectedVersion: number,
    change: AnnouncementChange,
  ): Promise<DomainResult<Announcement>> {
    const result = await this.db.withTxResult(async ({ db }) => {
      const a = schema.announcements;
      const [row] = await db.select().from(a).where(eq(a.id, id)).for("update");
      if (row === undefined) return notFound();
      if (row.version !== expectedVersion) return stale();
      await db
        .update(a)
        .set({
          ...definedFields({ title: change.title, bodyMd: change.bodyMd, pinned: change.pinned }),
          updatedAt: this.clock.now(),
          version: sql`${a.version} + 1`,
        })
        .where(eq(a.id, id));
      return ok(null);
    });
    return result.ok ? ok(await this.announcement(id)) : result;
  }

  async deleteAnnouncement(id: string): Promise<DomainResult<null>> {
    const a = schema.announcements;
    const [row] = await this.db.withTx(({ db }) =>
      db.delete(a).where(eq(a.id, id)).returning({ id: a.id }),
    );
    return row === undefined ? notFound() : ok(null);
  }

  async offeringOfAnnouncement(id: string): Promise<string | null> {
    const a = schema.announcements;
    const [row] = await this.db.read
      .select({ offeringId: a.courseOfferingId })
      .from(a)
      .where(eq(a.id, id));
    return row?.offeringId ?? null;
  }

  // ---- helpers ----

  private visible(manages: boolean): SQL | undefined {
    const m = schema.courseMaterials;
    if (manages) return ne(m.status, "ARCHIVED");
    return and(
      eq(m.status, "PUBLISHED"),
      eq(m.visibility, "ENROLLED"),
      or(isNull(m.publishAt), lte(m.publishAt, this.clock.now())),
    );
  }

  private async manages(userId: string, offeringId: string): Promise<boolean> {
    const decision = await this.authorization.authorize(
      this.authorization.principal(userId),
      "content:material:manage",
      { type: "course-offering", id: offeringId },
    );
    return decision === "ALLOW";
  }

  private async material(id: string): Promise<Material> {
    const m = schema.courseMaterials;
    const [row] = await this.db.read
      .select({ material: m, file: schema.files })
      .from(m)
      .leftJoin(schema.files, eq(schema.files.id, m.fileId))
      .where(eq(m.id, id));
    if (row === undefined) throw new Error(`material ${id} vanished`);
    return toMaterial(row.material, row.file);
  }

  private async announcement(id: string): Promise<Announcement> {
    const a = schema.announcements;
    const [row] = await this.db.read
      .select({ announcement: a, authorName: schema.users.displayName })
      .from(a)
      .innerJoin(schema.users, eq(schema.users.id, a.authorUserId))
      .where(eq(a.id, id));
    if (row === undefined) throw new Error(`announcement ${id} vanished`);
    return toAnnouncement(row.announcement, row.authorName);
  }
}

function toMaterial(row: MaterialRow, file: FileRow | null): Material {
  return {
    id: row.id,
    courseOfferingId: row.courseOfferingId,
    sectionLabel: row.sectionLabel,
    title: row.title,
    kind: row.kind as Material["kind"],
    url: row.url,
    bodyMd: row.bodyMd,
    bodyHtml: row.bodyMd === null ? null : renderMarkdown(row.bodyMd),
    file:
      file === null
        ? null
        : {
            id: file.id,
            name: file.originalName,
            mime: file.mime,
            sizeBytes: file.sizeBytes,
            downloadPath: `/api/v1/course-materials/${row.id}/download`,
          },
    visibility: row.visibility as Material["visibility"],
    publishAt: row.publishAt?.toISOString() ?? null,
    position: row.position,
    status: row.status as Material["status"],
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function toAnnouncement(row: AnnouncementRow, authorName: string): Announcement {
  return {
    id: row.id,
    courseOfferingId: row.courseOfferingId,
    title: row.title,
    bodyMd: row.bodyMd,
    bodyHtml: renderMarkdown(row.bodyMd),
    pinned: row.pinned,
    authorName,
    classMeetingId: row.classMeetingId,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}
