import type { DomainEventName, EnumValue } from "@glim/contracts";
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
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

export type AcademicSessionRow = typeof schema.academicSessions.$inferSelect;
export type SemesterRow = typeof schema.semesters.$inferSelect;
type SemesterStatus = EnumValue<"semesters.status">;

export interface SemesterDates {
  startsOn: string;
  endsOn: string;
  registrationOpensOn?: string | null | undefined;
  registrationClosesOn?: string | null | undefined;
  addDropDeadlineOn?: string | null | undefined;
  examsStartOn?: string | null | undefined;
  examsEndOn?: string | null | undefined;
}

/**
 * Work another module does when a semester closes, inside the closing transaction (each module
 * writes only its own tables, §4.3). Enrollment registers one to complete course enrollments.
 */
export type SemesterCloseStep = (db: Database, semesterId: string, now: Date) => Promise<void>;

const notFound = () => err(domainError("NOT_FOUND", "Not found."));
const stale = (what: string) =>
  err(domainError("VERSION_MISMATCH", `Someone else changed this ${what}. Reload and try again.`));
const semesterState = (message: string) => err(domainError("SEMESTER_STATE_INVALID", message));

/** Turns the calendar's database rules (§9.1, INV-4) into messages people can act on. */
function fromDatabase(error: unknown): DomainError | null {
  const pg = pgError(error);
  if (pg === null) return null;
  switch (pg.code) {
    case PG.EXCLUSION_VIOLATION:
      return pg.constraint === "academic_sessions_no_overlap"
        ? domainError("CONFLICT", "These dates overlap another Academic Session.")
        : domainError("CONFLICT", "These dates overlap the session's other semester.");
    case PG.UNIQUE_VIOLATION:
      return pg.constraint === "one_active_session"
        ? domainError("CONFLICT", "Another Academic Session is active. Close it first.")
        : domainError("CONFLICT", "That code or semester number is already in use.");
    case PG.CHECK_VIOLATION:
      return domainError(
        "VALIDATION_FAILED",
        "The dates are inconsistent: check that each period ends after it starts and that exams and the add/drop deadline fall inside the semester.",
      );
    default:
      return null;
  }
}

/** Academic Sessions and semesters, with their lifecycles (TRD §9.1, C-32). */
@Injectable()
export class CalendarService {
  private readonly closeSteps: SemesterCloseStep[] = [];

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Registers work to run in the transaction that closes a semester. */
  onSemesterClose(step: SemesterCloseStep): void {
    this.closeSteps.push(step);
  }

  // ---- Academic Sessions ----

  listSessions(): Promise<AcademicSessionRow[]> {
    return this.db.read
      .select()
      .from(schema.academicSessions)
      .orderBy(desc(schema.academicSessions.startsOn));
  }

  async getSession(id: string): Promise<AcademicSessionRow | null> {
    const [row] = await this.db.read
      .select()
      .from(schema.academicSessions)
      .where(eq(schema.academicSessions.id, id));
    return row ?? null;
  }

  createSession(
    input: { code: string; name: string; startsOn: string; endsOn: string },
    actor: AuditActor,
  ): Promise<DomainResult<AcademicSessionRow>> {
    return this.guarded(async ({ db }) => {
      const now = this.clock.now();
      const [row] = await db
        .insert(schema.academicSessions)
        .values({ ...input, createdAt: now, updatedAt: now })
        .returning();
      if (row === undefined) throw new Error("Session insert returned no row");
      await this.audit.record(db, actor, {
        action: "academic.session.created",
        resourceType: "academic-session",
        resourceId: row.id,
        metadata: { code: row.code },
      });
      return ok(row);
    });
  }

  updateSession(
    id: string,
    expectedVersion: number,
    change: Patch<{ name: string; startsOn: string; endsOn: string }>,
    actor: AuditActor,
  ): Promise<DomainResult<AcademicSessionRow>> {
    return this.guarded(async ({ db }) => {
      const current = await this.lockSession(db, id);
      if (current === null) return notFound();
      if (current.version !== expectedVersion) return stale("session");
      if (current.status !== "PLANNED")
        return err(domainError("CONFLICT", "Only a planned session's dates can change."));
      const row = await this.setSession(db, id, definedFields(change));
      await this.audit.record(db, actor, {
        action: "academic.session.updated",
        resourceType: "academic-session",
        resourceId: id,
        metadata: definedFields(change),
      });
      return ok(row);
    });
  }

  /** PLANNED → ACTIVE. Progression (Year 1 → Year 2, D-03) reacts to `academic.session.activated`. */
  activateSession(id: string, actor: AuditActor): Promise<DomainResult<AcademicSessionRow>> {
    return this.guarded(async ({ db, boss }) => {
      const current = await this.lockSession(db, id);
      if (current === null) return notFound();
      if (current.status !== "PLANNED")
        return err(domainError("CONFLICT", "Only a planned session can be activated."));
      const row = await this.setSession(db, id, { status: "ACTIVE" });
      await this.audit.record(db, actor, {
        action: "academic.session.activated",
        resourceType: "academic-session",
        resourceId: id,
      });
      await this.publish(boss, "academic.session.activated", { sessionId: id }, actor);
      return ok(row);
    });
  }

  /** ACTIVE → CLOSED, once every semester in it is closed. */
  closeSession(id: string, actor: AuditActor): Promise<DomainResult<AcademicSessionRow>> {
    return this.guarded(async ({ db }) => {
      const current = await this.lockSession(db, id);
      if (current === null) return notFound();
      if (current.status !== "ACTIVE")
        return err(domainError("CONFLICT", "Only the active session can be closed."));
      const open = await db
        .select({ id: schema.semesters.id })
        .from(schema.semesters)
        .where(
          and(eq(schema.semesters.academicSessionId, id), ne(schema.semesters.status, "CLOSED")),
        );
      if (open.length > 0)
        return err(domainError("CONFLICT", "Close every semester of this session first."));
      const row = await this.setSession(db, id, { status: "CLOSED" });
      await this.audit.record(db, actor, {
        action: "academic.session.closed",
        resourceType: "academic-session",
        resourceId: id,
      });
      return ok(row);
    });
  }

  // ---- Semesters ----

  listSemesters(sessionId?: string): Promise<SemesterRow[]> {
    const s = schema.semesters;
    return this.db.read
      .select()
      .from(s)
      .where(sessionId === undefined ? undefined : eq(s.academicSessionId, sessionId))
      .orderBy(asc(s.startsOn));
  }

  async getSemester(id: string): Promise<SemesterRow | null> {
    const [row] = await this.db.read
      .select()
      .from(schema.semesters)
      .where(eq(schema.semesters.id, id));
    return row ?? null;
  }

  createSemester(
    input: SemesterDates & {
      academicSessionId: string;
      code: string;
      name: string;
      sequence: 1 | 2;
    },
    actor: AuditActor,
  ): Promise<DomainResult<SemesterRow>> {
    return this.guarded(async ({ db }) => {
      const session = await this.lockSession(db, input.academicSessionId);
      if (session === null) {
        return err(
          domainError("VALIDATION_FAILED", "The Academic Session doesn't exist.", {
            fieldErrors: [
              {
                path: "body.academicSessionId",
                code: "not_found",
                message: "The Academic Session doesn't exist.",
              },
            ],
          }),
        );
      }
      if (session.status === "CLOSED")
        return err(domainError("CONFLICT", "That Academic Session is closed."));
      const outside = this.outsideSession(session, input);
      if (outside) return err(outside);
      const now = this.clock.now();
      const [row] = await db
        .insert(schema.semesters)
        .values({ ...input, createdAt: now, updatedAt: now })
        .returning();
      if (row === undefined) throw new Error("Semester insert returned no row");
      const order = await this.checkOrder(db, row);
      if (order) return err(order);
      await this.audit.record(db, actor, {
        action: "academic.semester.created",
        resourceType: "semester",
        resourceId: row.id,
        metadata: { code: row.code, sessionId: session.id },
      });
      return ok(row);
    });
  }

  updateSemester(
    id: string,
    expectedVersion: number,
    change: Patch<SemesterDates & { name: string }>,
    actor: AuditActor,
  ): Promise<DomainResult<SemesterRow>> {
    return this.guarded(async ({ db }) => {
      const current = await this.lockSemester(db, id);
      if (current === null) return notFound();
      if (current.version !== expectedVersion) return stale("semester");
      if (current.status === "CLOSED") return semesterState("A closed semester can't change.");
      const fields = definedFields(change);
      const session = await this.lockSession(db, current.academicSessionId);
      const next = { ...current, ...fields };
      const outside = session === null ? null : this.outsideSession(session, next);
      if (outside) return err(outside);
      const row = await this.setSemester(db, id, fields);
      const order = await this.checkOrder(db, row);
      if (order) return err(order);
      await this.audit.record(db, actor, {
        action: "academic.semester.updated",
        resourceType: "semester",
        resourceId: id,
        metadata: fields,
      });
      return ok(row);
    });
  }

  /**
   * PLANNED → REGISTRATION, in an active session. Compulsory auto-registration (ticket 19) reacts
   * to `academic.semester.registration-opened`.
   */
  openRegistration(id: string, actor: AuditActor): Promise<DomainResult<SemesterRow>> {
    return this.transition(id, "PLANNED", "REGISTRATION", actor, async (db, semester) => {
      const session = await this.lockSession(db, semester.academicSessionId);
      return session?.status === "ACTIVE"
        ? null
        : domainError(
            "SEMESTER_STATE_INVALID",
            "Activate the Academic Session before opening registration.",
          );
    });
  }

  /** REGISTRATION → ACTIVE: teaching starts. */
  activateSemester(id: string, actor: AuditActor): Promise<DomainResult<SemesterRow>> {
    return this.transition(id, "REGISTRATION", "ACTIVE", actor);
  }

  /**
   * ACTIVE → CLOSED (§9.1). In the same transaction the semester's running offerings become
   * COMPLETED and the registered close steps run (enrollment completes ENROLLED course
   * enrollments). Cancelled and never-published offerings are left as they are.
   */
  closeSemester(id: string, actor: AuditActor): Promise<DomainResult<SemesterRow>> {
    return this.transition(id, "ACTIVE", "CLOSED", actor, undefined, async (db) => {
      const now = this.clock.now();
      const o = schema.courseOfferings;
      await db
        .update(o)
        .set({ status: "COMPLETED", completedAt: now, updatedAt: now })
        .where(and(eq(o.semesterId, id), inArray(o.status, ["PUBLISHED", "ACTIVE"])));
      for (const step of this.closeSteps) await step(db, id, now);
    });
  }

  private transition(
    id: string,
    from: SemesterStatus,
    to: SemesterStatus,
    actor: AuditActor,
    precondition?: (db: Database, semester: SemesterRow) => Promise<DomainError | null>,
    effect?: (db: Database) => Promise<void>,
  ): Promise<DomainResult<SemesterRow>> {
    return this.guarded(async ({ db, boss }) => {
      const current = await this.lockSemester(db, id);
      if (current === null) return notFound();
      if (current.status !== from) {
        return semesterState(
          `The semester is ${current.status.toLowerCase()}; it must be ${from.toLowerCase()} for this.`,
        );
      }
      const problem = precondition ? await precondition(db, current) : null;
      if (problem) return err(problem);
      const row = await this.setSemester(db, id, { status: to });
      if (effect) await effect(db);
      await this.audit.record(db, actor, {
        action: `academic.semester.${to.toLowerCase()}`,
        resourceType: "semester",
        resourceId: id,
        metadata: { from, to },
      });
      const event = SEMESTER_EVENTS[to];
      if (event)
        await this.publish(
          boss,
          event,
          { semesterId: id, sessionId: row.academicSessionId },
          actor,
        );
      return ok(row);
    });
  }

  // ---- helpers ----

  /** A transaction whose database-rule violations become domain errors instead of 500s. */
  private async guarded<T>(
    fn: (tx: { db: Database; boss: TxQueue }) => Promise<DomainResult<T>>,
  ): Promise<DomainResult<T>> {
    try {
      return await this.db.withTxResult(fn);
    } catch (error) {
      const known = fromDatabase(error);
      if (known === null) throw error;
      return err(known);
    }
  }

  private outsideSession(
    session: AcademicSessionRow,
    dates: { startsOn: string; endsOn: string },
  ): DomainError | null {
    if (dates.startsOn < session.startsOn || dates.endsOn > session.endsOn) {
      return domainError(
        "VALIDATION_FAILED",
        `A semester must fall within its session (${session.startsOn} to ${session.endsOn}).`,
      );
    }
    return null;
  }

  /** Semester 1 comes before semester 2; the caller returns the error, which rolls the change back. */
  private async checkOrder(db: Database, semester: SemesterRow): Promise<DomainError | null> {
    const siblings = await db
      .select()
      .from(schema.semesters)
      .where(
        and(
          eq(schema.semesters.academicSessionId, semester.academicSessionId),
          ne(schema.semesters.id, semester.id),
        ),
      );
    const wrong = siblings.some(
      (other) => other.sequence < semester.sequence !== other.startsOn < semester.startsOn,
    );
    if (!wrong) return null;
    return domainError("VALIDATION_FAILED", "Semester 1 must come before semester 2.");
  }

  private async lockSession(db: Database, id: string): Promise<AcademicSessionRow | null> {
    const [row] = await db
      .select()
      .from(schema.academicSessions)
      .where(eq(schema.academicSessions.id, id))
      .for("update");
    return row ?? null;
  }

  private async lockSemester(db: Database, id: string): Promise<SemesterRow | null> {
    const [row] = await db
      .select()
      .from(schema.semesters)
      .where(eq(schema.semesters.id, id))
      .for("update");
    return row ?? null;
  }

  private async setSession(
    db: Database,
    id: string,
    fields: Record<string, unknown>,
  ): Promise<AcademicSessionRow> {
    const t = schema.academicSessions;
    const [row] = await db
      .update(t)
      .set({ ...fields, updatedAt: this.clock.now(), version: sql`${t.version} + 1` })
      .where(eq(t.id, id))
      .returning();
    if (row === undefined) throw new Error("Session update returned no row");
    return row;
  }

  private async setSemester(
    db: Database,
    id: string,
    fields: Record<string, unknown>,
  ): Promise<SemesterRow> {
    const t = schema.semesters;
    const [row] = await db
      .update(t)
      .set({ ...fields, updatedAt: this.clock.now(), version: sql`${t.version} + 1` })
      .where(eq(t.id, id))
      .returning();
    if (row === undefined) throw new Error("Semester update returned no row");
    return row;
  }

  private async publish(
    boss: TxQueue,
    name: DomainEventName,
    payload: Record<string, unknown>,
    actor: AuditActor,
  ): Promise<void> {
    await boss.publish(name, payload, { occurredAt: this.clock.now(), actorUserId: actor.userId });
  }
}

const SEMESTER_EVENTS: Partial<Record<SemesterStatus, DomainEventName>> = {
  REGISTRATION: "academic.semester.registration-opened",
  CLOSED: "academic.semester.closed",
};
