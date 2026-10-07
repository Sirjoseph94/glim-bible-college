import { Db, PG, pgError, schema, type Database, type TxQueue } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import {
  CLOCK,
  definedFields,
  domainError,
  err,
  ok,
  type Clock,
  type DomainError,
  type DomainResult,
  type Patch,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

export type OfferingRow = typeof schema.courseOfferings.$inferSelect;

/** A rule another module adds to publishing, e.g. "has an active Primary Lecturer" (§9.1). */
export type PublishRequirement = (db: Database, offeringId: string) => Promise<DomainError | null>;

export interface OfferingInput {
  courseId: string;
  semesterId: string;
  sectionCode: string;
  titleOverride: string | null;
  capacity: number | null;
}

const notFound = () => err(domainError("NOT_FOUND", "Not found."));

/** Course Offerings: a course taught in a semester (owner: academic, TRD §9.1–9.2). */
@Injectable()
export class OfferingsService {
  private readonly publishRequirements: PublishRequirement[] = [];

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Called once by modules that add conditions to publishing. */
  registerPublishRequirement(requirement: PublishRequirement): void {
    this.publishRequirements.push(requirement);
  }

  /** Inserts an offering inside the caller's transaction (§9.2 step 1–2), so staffing can join it. */
  async insert(
    db: Database,
    boss: TxQueue,
    input: OfferingInput,
    actor: AuditActor,
  ): Promise<DomainResult<OfferingRow>> {
    const [course] = await db
      .select({ status: schema.courses.status })
      .from(schema.courses)
      .where(eq(schema.courses.id, input.courseId));
    if (course?.status !== "ACTIVE") return err(invalid("courseId", "Choose an active course."));
    const [semester] = await db
      .select({ status: schema.semesters.status })
      .from(schema.semesters)
      .where(eq(schema.semesters.id, input.semesterId));
    if (semester === undefined) return err(invalid("semesterId", "That semester doesn't exist."));
    if (semester.status === "CLOSED")
      return err(domainError("SEMESTER_STATE_INVALID", "That semester is closed."));

    const now = this.clock.now();
    let row: OfferingRow | undefined;
    try {
      [row] = await db
        .insert(schema.courseOfferings)
        .values({ ...input, createdAt: now, updatedAt: now })
        .returning();
    } catch (error) {
      if (pgError(error)?.code === PG.UNIQUE_VIOLATION) {
        return err(
          domainError(
            "CONFLICT",
            "That course already has an offering with this section code in this semester.",
          ),
        );
      }
      throw error;
    }
    if (row === undefined) throw new Error("Offering insert returned no row");
    await this.audit.record(db, actor, {
      action: "academic.offering.created",
      resourceType: "course-offering",
      resourceId: row.id,
    });
    await boss.publish(
      "course.offering.created",
      { offeringId: row.id },
      { occurredAt: now, actorUserId: actor.userId },
    );
    return ok(row);
  }

  async get(id: string, db: Database = this.db.read): Promise<OfferingRow | null> {
    const [row] = await db
      .select()
      .from(schema.courseOfferings)
      .where(eq(schema.courseOfferings.id, id));
    return row ?? null;
  }

  update(
    id: string,
    expectedVersion: number,
    change: Patch<{ titleOverride: string | null; capacity: number | null }>,
    actor: AuditActor,
  ): Promise<DomainResult<OfferingRow>> {
    return this.db.withTxResult(async ({ db }) => {
      const o = schema.courseOfferings;
      const fields = definedFields(change);
      const [row] = await db
        .update(o)
        .set({ ...fields, updatedAt: this.clock.now(), version: sql`${o.version} + 1` })
        .where(and(eq(o.id, id), eq(o.version, expectedVersion)))
        .returning();
      if (row === undefined)
        return err(
          domainError(
            "VERSION_MISMATCH",
            "Someone else changed this offering. Reload and try again.",
          ),
        );
      await this.audit.record(db, actor, {
        action: "academic.offering.updated",
        resourceType: "course-offering",
        resourceId: id,
        metadata: fields,
      });
      return ok(row);
    });
  }

  /** DRAFT → PUBLISHED, once every registered requirement (an active Primary) holds. */
  publish(id: string, actor: AuditActor): Promise<DomainResult<OfferingRow>> {
    return this.db.withTxResult(async ({ db, boss }) => {
      const current = await this.lock(db, id);
      if (current === null) return notFound();
      if (current.status !== "DRAFT")
        return err(domainError("CONFLICT", "Only a draft offering can be published."));
      for (const requirement of this.publishRequirements) {
        const problem = await requirement(db, id);
        if (problem) return err(problem);
      }
      const row = await this.setStatus(db, id, "PUBLISHED");
      await this.audit.record(db, actor, {
        action: "academic.offering.published",
        resourceType: "course-offering",
        resourceId: id,
      });
      await boss.publish(
        "course.offering.published",
        { offeringId: id },
        { occurredAt: this.clock.now(), actorUserId: actor.userId },
      );
      return ok(row);
    });
  }

  /** Any open offering → CANCELLED. Future Class Meetings and notifications react to the event. */
  cancel(id: string, reason: string, actor: AuditActor): Promise<DomainResult<OfferingRow>> {
    return this.db.withTxResult(async ({ db, boss }) => {
      const current = await this.lock(db, id);
      if (current === null) return notFound();
      if (current.status === "COMPLETED" || current.status === "CANCELLED") {
        return err(
          domainError("CONFLICT", `A ${current.status.toLowerCase()} offering can't be cancelled.`),
        );
      }
      const row = await this.setStatus(db, id, "CANCELLED");
      await this.audit.record(db, actor, {
        action: "academic.offering.cancelled",
        resourceType: "course-offering",
        resourceId: id,
        metadata: { reason, from: current.status },
      });
      await boss.publish(
        "course.offering.cancelled",
        { offeringId: id },
        { occurredAt: this.clock.now(), actorUserId: actor.userId },
      );
      return ok(row);
    });
  }

  /** Locks the offering row for a change that depends on its status. */
  async lock(db: Database, id: string): Promise<OfferingRow | null> {
    const [row] = await db
      .select()
      .from(schema.courseOfferings)
      .where(eq(schema.courseOfferings.id, id))
      .for("update");
    return row ?? null;
  }

  private async setStatus(
    db: Database,
    id: string,
    status: OfferingRow["status"],
  ): Promise<OfferingRow> {
    const o = schema.courseOfferings;
    const [row] = await db
      .update(o)
      .set({ status, updatedAt: this.clock.now(), version: sql`${o.version} + 1` })
      .where(eq(o.id, id))
      .returning();
    if (row === undefined) throw new Error("Offering update returned no row");
    return row;
  }
}

function invalid(field: string, message: string): DomainError {
  return domainError("VALIDATION_FAILED", message, {
    fieldErrors: [{ path: `body.${field}`, code: "invalid", message }],
  });
}
