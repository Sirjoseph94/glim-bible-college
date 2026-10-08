import type { EnumValue } from "@glim/contracts";
import { Db, pgError, schema } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { StaffAccountsService, UserService, type UserProfile } from "@glim/modules/identity";
import {
  CLOCK,
  definedFields,
  domainError,
  err,
  ok,
  type Clock,
  type DomainResult,
  type Patch,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";

export interface LecturerView {
  id: string;
  userId: string;
  email: string;
  title: string | null;
  givenName: string;
  familyName: string;
  displayName: string;
  staffCode: string | null;
  kind: EnumValue<"lecturers.kind">;
  status: EnumValue<"lecturers.status">;
  version: number;
}

export interface LecturerInput {
  email: string;
  title: string | null;
  givenName: string;
  familyName: string;
  kind: EnumValue<"lecturers.kind">;
  staffCode: string | null;
}

export function lecturerName(l: {
  title: string | null;
  givenName: string;
  familyName: string;
}): string {
  return [l.title, l.givenName, l.familyName]
    .filter((part) => part !== null && part !== "")
    .join(" ");
}

/** Lecturer profiles (owner: lecturing, TRD §6.3). A Lecturer is a user with this profile. */
@Injectable()
export class LecturersService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(UserService) private readonly users: UserService,
    @Inject(StaffAccountsService) private readonly staff: StaffAccountsService,
  ) {}

  async list(): Promise<LecturerView[]> {
    const l = schema.lecturers;
    const rows = await this.db.read
      .select({ lecturer: l, email: schema.users.email })
      .from(l)
      .innerJoin(schema.users, eq(schema.users.id, l.userId))
      .orderBy(asc(l.familyName), asc(l.givenName));
    return rows.map((r) => toView(r.lecturer, r.email));
  }

  async get(id: string): Promise<LecturerView | null> {
    const l = schema.lecturers;
    const [row] = await this.db.read
      .select({ lecturer: l, email: schema.users.email })
      .from(l)
      .innerJoin(schema.users, eq(schema.users.id, l.userId))
      .where(eq(l.id, id));
    return row === undefined ? null : toView(row.lecturer, row.email);
  }

  /** Links the account with this email, or invites a new one, and gives it a Lecturer profile. */
  async create(
    input: LecturerInput,
    actor: AuditActor,
  ): Promise<DomainResult<{ lecturer: LecturerView; invited: boolean }>> {
    const created = await this.guardStaffCode(() =>
      this.db.withTxResult(async ({ db }) => {
        const existing = await this.users.findByEmail(input.email, db);
        let userId: string;
        let invite: { user: UserProfile; token: string } | null = null;
        if (existing === null) {
          const made = await this.staff.createInvited(
            db,
            { email: input.email, displayName: lecturerName(input), roles: [] },
            actor,
          );
          if (!made.ok) return made;
          userId = made.value.user.id;
          invite = made.value;
        } else {
          userId = existing.id;
          await this.users.ensureReferralCode(db, userId);
        }
        const now = this.clock.now();
        const [row] = await db
          .insert(schema.lecturers)
          .values({
            userId,
            title: input.title,
            givenName: input.givenName,
            familyName: input.familyName,
            kind: input.kind,
            staffCode: input.staffCode,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({ target: schema.lecturers.userId })
          .returning({ id: schema.lecturers.id });
        if (row === undefined)
          return err(domainError("CONFLICT", "That person is already a Lecturer."));
        await this.audit.record(db, actor, {
          action: "lecturing.lecturer.created",
          resourceType: "lecturer",
          resourceId: row.id,
          metadata: { userId, invited: invite !== null },
        });
        return ok({ id: row.id, invite });
      }),
    );
    if (!created.ok) return created;
    if (created.value.invite !== null) await this.staff.sendInvite(ok(created.value.invite));
    const lecturer = await this.get(created.value.id);
    if (lecturer === null) throw new Error("Lecturer vanished after insert");
    return ok({ lecturer, invited: created.value.invite !== null });
  }

  async update(
    id: string,
    expectedVersion: number,
    change: Patch<Omit<LecturerInput, "email"> & { status: EnumValue<"lecturers.status"> }>,
    actor: AuditActor,
  ): Promise<DomainResult<LecturerView>> {
    const result = await this.guardStaffCode(() =>
      this.db.withTxResult(async ({ db }) => {
        const l = schema.lecturers;
        const fields = definedFields(change);
        const [row] = await db
          .update(l)
          .set({ ...fields, updatedAt: this.clock.now(), version: sql`${l.version} + 1` })
          .where(and(eq(l.id, id), eq(l.version, expectedVersion)))
          .returning({ id: l.id });
        if (row === undefined)
          return err(
            domainError(
              "VERSION_MISMATCH",
              "Someone else changed this Lecturer. Reload and try again.",
            ),
          );
        await this.audit.record(db, actor, {
          action: "lecturing.lecturer.updated",
          resourceType: "lecturer",
          resourceId: id,
          metadata: fields,
        });
        return ok(null);
      }),
    );
    if (!result.ok) return result;
    const lecturer = await this.get(id);
    return lecturer === null ? err(domainError("NOT_FOUND", "Not found.")) : ok(lecturer);
  }

  private async guardStaffCode<T>(fn: () => Promise<DomainResult<T>>): Promise<DomainResult<T>> {
    try {
      return await fn();
    } catch (error) {
      if (pgError(error)?.constraint === "lecturers_staff_code_unique") {
        return err(domainError("CONFLICT", "Another Lecturer has that staff code."));
      }
      throw error;
    }
  }
}

function toView(l: typeof schema.lecturers.$inferSelect, email: string): LecturerView {
  return {
    id: l.id,
    userId: l.userId,
    email,
    title: l.title,
    givenName: l.givenName,
    familyName: l.familyName,
    displayName: lecturerName(l),
    staffCode: l.staffCode,
    kind: l.kind as LecturerView["kind"],
    status: l.status as LecturerView["status"],
    version: l.version,
  };
}
