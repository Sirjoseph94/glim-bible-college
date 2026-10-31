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
import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";

export type OfferingRow = typeof schema.courseOfferings.$inferSelect;

/** A rule another module adds to publishing, e.g. "has an active Primary Lecturer" (§9.1). */
export type PublishRequirement = (db: Database, offeringId: string) => Promise<DomainError | null>;

/** Work another module does in the publishing transaction, e.g. registering the cohort (§9.3). */
export type PublishStep = (db: Database, boss: TxQueue, offering: OfferingRow) => Promise<void>;

/** Work another module does when an offering completes, e.g. completing its enrollments. */
export type CompleteStep = (db: Database, offeringId: string, now: Date) => Promise<void>;

/**
 * A rule another module adds to changing an offering's dates, e.g. "its Class Meetings still fit"
 * (ADR-0005).
 */
export type DatesCheck = (
  db: Database,
  offeringId: string,
  dates: OfferingDates,
) => Promise<DomainError | null>;

export interface OfferingDates {
  startsOn: string;
  endsOn: string;
  examOn: string;
}

export interface OfferingInput extends OfferingDates {
  courseId: string;
  cohortId: string;
  titleOverride: string | null;
  capacity: number | null;
}

export type OfferingChange = Patch<
  OfferingDates & { titleOverride: string | null; capacity: number | null }
>;

const notFound = () => err(domainError("NOT_FOUND", "Not found."));
const overlap = () =>
  domainError(
    "OFFERING_OVERLAP",
    "Another of this cohort's offerings covers some of the same days. A cohort takes one course at a time.",
  );

/**
 * Course Offerings: one run of a course for one cohort, between its own dates, with its exam date
 * (owner: academic, TRD §9.1–9.2, ADR-0005).
 */
@Injectable()
export class OfferingsService {
  private readonly publishRequirements: PublishRequirement[] = [];
  private readonly publishSteps: PublishStep[] = [];
  private readonly datesChecks: DatesCheck[] = [];
  private readonly completeSteps: CompleteStep[] = [];

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Called once by modules that add conditions to publishing. */
  registerPublishRequirement(requirement: PublishRequirement): void {
    this.publishRequirements.push(requirement);
  }

  /** Called once by modules with work to do when an offering is published. */
  registerPublishStep(step: PublishStep): void {
    this.publishSteps.push(step);
  }

  /** Called once by modules with conditions on moving an offering's dates. */
  registerDatesCheck(check: DatesCheck): void {
    this.datesChecks.push(check);
  }

  /** Called once by modules with work to do when an offering completes. */
  registerCompleteStep(step: CompleteStep): void {
    this.completeSteps.push(step);
  }

  /**
   * The daily lifecycle (`academic.offering-lifecycle`, ADR-0005), for the institution's `today`:
   * PUBLISHED offerings that have started become ACTIVE; PUBLISHED or ACTIVE ones whose end date
   * has passed become COMPLETED, each in its own transaction with the registered steps (their
   * enrollments complete) and `academic.offering.completed`. Idempotent.
   */
  async advance(today: string): Promise<{ started: number; completed: number }> {
    const o = schema.courseOfferings;
    const actor: AuditActor = { userId: null, type: "JOB" };
    const started = await this.db.withTx(async ({ db }) => {
      const rows = await db
        .update(o)
        .set({ status: "ACTIVE", updatedAt: this.clock.now(), version: sql`${o.version} + 1` })
        .where(and(eq(o.status, "PUBLISHED"), lte(o.startsOn, today), gte(o.endsOn, today)))
        .returning({ id: o.id });
      for (const row of rows)
        await this.audit.record(db, actor, {
          action: "academic.offering.started",
          resourceType: "course-offering",
          resourceId: row.id,
        });
      return rows.length;
    });
    const due = await this.db.read
      .select({ id: o.id })
      .from(o)
      .where(and(inArray(o.status, ["PUBLISHED", "ACTIVE"]), lt(o.endsOn, today)));
    let completed = 0;
    for (const { id } of due) {
      const done = await this.db.withTx(async ({ db, boss }) => {
        const current = await this.lock(db, id);
        if (current === null || !["PUBLISHED", "ACTIVE"].includes(current.status)) return false;
        const now = this.clock.now();
        await db
          .update(o)
          .set({
            status: "COMPLETED",
            completedAt: now,
            updatedAt: now,
            version: sql`${o.version} + 1`,
          })
          .where(eq(o.id, id));
        for (const step of this.completeSteps) await step(db, id, now);
        await this.audit.record(db, actor, {
          action: "academic.offering.completed",
          resourceType: "course-offering",
          resourceId: id,
        });
        await boss.publish(
          "academic.offering.completed",
          { offeringId: id },
          { occurredAt: now, actorUserId: null },
        );
        return true;
      });
      if (done) completed++;
    }
    return { started, completed };
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
    const cohort = await this.cohortOf(db, input.cohortId);
    if (cohort === null) return err(invalid("cohortId", "That cohort doesn't exist."));
    if (cohort.status !== "ACTIVE") return err(invalid("cohortId", "That cohort is closed."));
    const problem = checkDates(input, cohort.startsOn);
    if (problem !== null) return err(problem);

    const now = this.clock.now();
    let row: OfferingRow | undefined;
    try {
      [row] = await db
        .insert(schema.courseOfferings)
        .values({ ...input, createdAt: now, updatedAt: now })
        .returning();
    } catch (error) {
      const code = pgError(error)?.code;
      if (code === PG.EXCLUSION_VIOLATION) return err(overlap());
      if (code === PG.UNIQUE_VIOLATION) {
        return err(domainError("CONFLICT", "This cohort already has an offering of that course."));
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

  /**
   * Changes an offering's dates, title or capacity. Dates can't move once it's completed or
   * cancelled, must still fit the cohort (ADR-0005) and every registered check, e.g. its Class
   * Meetings.
   */
  update(
    id: string,
    expectedVersion: number,
    change: OfferingChange,
    actor: AuditActor,
  ): Promise<DomainResult<OfferingRow>> {
    return this.db.withTxResult(async ({ db }) => {
      const o = schema.courseOfferings;
      const current = await this.lock(db, id);
      if (current === null) return notFound();
      if (current.version !== expectedVersion) return versionMismatch();
      const fields = definedFields(change);
      const dates = {
        startsOn: change.startsOn ?? current.startsOn,
        endsOn: change.endsOn ?? current.endsOn,
        examOn: change.examOn ?? current.examOn,
      };
      const moved =
        dates.startsOn !== current.startsOn ||
        dates.endsOn !== current.endsOn ||
        dates.examOn !== current.examOn;
      if (moved) {
        if (current.status === "COMPLETED" || current.status === "CANCELLED")
          return err(
            domainError(
              "CONFLICT",
              `A ${current.status.toLowerCase()} offering's dates can't change.`,
            ),
          );
        const cohort = await this.cohortOf(db, current.cohortId);
        const problem = checkDates(dates, cohort?.startsOn ?? dates.startsOn);
        if (problem !== null) return err(problem);
        for (const check of this.datesChecks) {
          const failed = await check(db, id, dates);
          if (failed) return err(failed);
        }
      }
      let row: OfferingRow | undefined;
      try {
        [row] = await db
          .update(o)
          .set({ ...fields, updatedAt: this.clock.now(), version: sql`${o.version} + 1` })
          .where(eq(o.id, id))
          .returning();
      } catch (error) {
        if (pgError(error)?.code === PG.EXCLUSION_VIOLATION) return err(overlap());
        throw error;
      }
      if (row === undefined) throw new Error("Offering update returned no row");
      await this.audit.record(db, actor, {
        action: "academic.offering.updated",
        resourceType: "course-offering",
        resourceId: id,
        metadata: fields,
      });
      return ok(row);
    });
  }

  /**
   * DRAFT → PUBLISHED, once every registered requirement (an active Primary) holds; registered
   * steps (registering the cohort's students) run in the same transaction.
   */
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
      for (const step of this.publishSteps) await step(db, boss, row);
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

  private async cohortOf(
    db: Database,
    cohortId: string,
  ): Promise<{ status: string; startsOn: string } | null> {
    const c = schema.cohorts;
    const [row] = await db
      .select({ status: c.status, startsOn: schema.intakes.startsOn })
      .from(c)
      .innerJoin(schema.intakes, eq(schema.intakes.id, c.intakeId))
      .where(eq(c.id, cohortId));
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

/** The exam falls within the offering, which can't start before its cohort does. */
function checkDates(dates: OfferingDates, cohortStartsOn: string): DomainError | null {
  if (dates.endsOn < dates.startsOn)
    return invalid("endsOn", "The offering must end on or after the day it starts.");
  if (dates.examOn < dates.startsOn || dates.examOn > dates.endsOn)
    return invalid("examOn", "The exam date must fall within the offering's dates.");
  if (dates.startsOn < cohortStartsOn)
    return domainError(
      "BEFORE_INTAKE_START",
      `This cohort starts on ${cohortStartsOn}; its offerings can't start before then.`,
    );
  return null;
}

function versionMismatch() {
  return err(
    domainError("VERSION_MISMATCH", "Someone else changed this offering. Reload and try again."),
  );
}

function invalid(field: string, message: string): DomainError {
  return domainError("VALIDATION_FAILED", message, {
    fieldErrors: [{ path: `body.${field}`, code: "invalid", message }],
  });
}
