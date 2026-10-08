import type { EnumValue } from "@glim/contracts";
import { Db, schema, type Database, type TxQueue } from "@glim/db";
import { OfferingsService, type OfferingInput } from "@glim/modules/academic";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { SettingsService } from "@glim/modules/identity";
import {
  CLOCK,
  domainError,
  err,
  ok,
  type Clock,
  type DomainError,
  type DomainResult,
} from "@glim/shared";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

export type LecturerRole = EnumValue<"lecturer_assignments.role">;

const PRIMARY_REQUIRED = domainError(
  "PRIMARY_REQUIRED",
  "This offering needs an active Primary Lecturer. Assign a new Primary instead (that replaces the current one).",
);

/**
 * Work another module does in the same transaction when a Lecturer joins or leaves an offering
 * (§9.4): scheduling books or frees their future Class Meetings. `added` may refuse the change
 * (e.g. the Lecturer is busy then).
 */
export interface AssignmentListener {
  added(
    db: Database,
    change: { offeringId: string; lecturerId: string },
  ): Promise<DomainError | null>;
  ended(db: Database, change: { offeringId: string; lecturerId: string }): Promise<void>;
}

/** Who teaches what (owner: lecturing, TRD §9.4). Exactly one active PRIMARY per offering. */
@Injectable()
export class AssignmentsService implements OnModuleInit {
  private readonly listeners: AssignmentListener[] = [];

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OfferingsService) private readonly offerings: OfferingsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** Publishing an offering requires an active Primary Lecturer (§9.1). */
  onModuleInit(): void {
    this.offerings.registerPublishRequirement(async (db, offeringId) =>
      (await this.hasActivePrimary(db, offeringId)) ? null : PRIMARY_REQUIRED,
    );
  }

  /** Registers work to run whenever an assignment starts or ends. */
  onAssignmentChange(listener: AssignmentListener): void {
    this.listeners.push(listener);
  }

  /** Creates an offering and its first assignments in one transaction (§9.2). */
  createOfferingWithLecturers(
    input: OfferingInput & { lecturers: { lecturerId: string; role: LecturerRole }[] },
    actor: AuditActor,
  ): Promise<DomainResult<string>> {
    if (input.lecturers.filter((l) => l.role === "PRIMARY").length > 1) {
      return Promise.resolve(
        err(domainError("VALIDATION_FAILED", "An offering has one Primary Lecturer.")),
      );
    }
    return this.db.withTxResult(async ({ db, boss }) => {
      const { lecturers, ...offering } = input;
      const created = await this.offerings.insert(db, boss, offering, actor);
      if (!created.ok) return created;
      for (const lecturer of lecturers) {
        const assigned = await this.assignIn(
          db,
          boss,
          created.value.id,
          lecturer.lecturerId,
          lecturer.role,
          actor,
        );
        if (!assigned.ok) return assigned;
      }
      return ok(created.value.id);
    });
  }

  /** Assigns a Lecturer; a new PRIMARY replaces the current one in the same transaction (§9.4). */
  assign(
    offeringId: string,
    lecturerId: string,
    role: LecturerRole,
    actor: AuditActor,
  ): Promise<DomainResult<null>> {
    return this.db.withTxResult(async ({ db, boss }) => {
      const offering = await this.offerings.lock(db, offeringId);
      if (offering === null) return err(domainError("NOT_FOUND", "Not found."));
      if (offering.status === "COMPLETED" || offering.status === "CANCELLED") {
        return err(
          domainError(
            "CONFLICT",
            `Lecturers can't be assigned to a ${offering.status.toLowerCase()} offering.`,
          ),
        );
      }
      const assigned = await this.assignIn(db, boss, offeringId, lecturerId, role, actor);
      return assigned.ok ? ok(null) : assigned;
    });
  }

  /** Ends an assignment. The only Primary of a published or active offering can't be ended. */
  end(offeringId: string, assignmentId: string, actor: AuditActor): Promise<DomainResult<null>> {
    return this.db.withTxResult(async ({ db, boss }) => {
      const offering = await this.offerings.lock(db, offeringId);
      if (offering === null) return err(domainError("NOT_FOUND", "Not found."));
      const la = schema.lecturerAssignments;
      const [assignment] = await db
        .select()
        .from(la)
        .where(
          and(
            eq(la.id, assignmentId),
            eq(la.courseOfferingId, offeringId),
            eq(la.status, "ACTIVE"),
          ),
        );
      if (assignment === undefined)
        return err(domainError("NOT_FOUND", "That assignment doesn't exist or has already ended."));
      if (
        assignment.role === "PRIMARY" &&
        (offering.status === "PUBLISHED" || offering.status === "ACTIVE")
      ) {
        return err(PRIMARY_REQUIRED);
      }
      await this.endIn(db, boss, assignment, actor);
      return ok(null);
    });
  }

  async hasActivePrimary(db: Database, offeringId: string): Promise<boolean> {
    const la = schema.lecturerAssignments;
    const [row] = await db
      .select({ id: la.id })
      .from(la)
      .where(
        and(eq(la.courseOfferingId, offeringId), eq(la.role, "PRIMARY"), eq(la.status, "ACTIVE")),
      );
    return row !== undefined;
  }

  private async assignIn(
    db: Database,
    boss: TxQueue,
    offeringId: string,
    lecturerId: string,
    role: LecturerRole,
    actor: AuditActor,
  ): Promise<DomainResult<string>> {
    const [lecturer] = await db
      .select({ status: schema.lecturers.status })
      .from(schema.lecturers)
      .where(eq(schema.lecturers.id, lecturerId));
    if (lecturer?.status !== "ACTIVE")
      return err(invalid("lecturerId", "Choose an active Lecturer."));

    const la = schema.lecturerAssignments;
    const [already] = await db
      .select({ id: la.id })
      .from(la)
      .where(
        and(
          eq(la.courseOfferingId, offeringId),
          eq(la.lecturerId, lecturerId),
          eq(la.status, "ACTIVE"),
        ),
      );
    if (already !== undefined)
      return err(domainError("CONFLICT", "That Lecturer is already assigned to this offering."));

    if (role === "PRIMARY") {
      const [primary] = await db
        .select()
        .from(la)
        .where(
          and(eq(la.courseOfferingId, offeringId), eq(la.role, "PRIMARY"), eq(la.status, "ACTIVE")),
        );
      if (primary !== undefined) await this.endIn(db, boss, primary, actor);
    }

    const now = this.clock.now();
    const [row] = await db
      .insert(la)
      .values({
        courseOfferingId: offeringId,
        lecturerId,
        role,
        startsOn: await this.settings.today(),
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: la.id });
    if (row === undefined) throw new Error("Assignment insert returned no row");
    for (const listener of this.listeners) {
      const problem = await listener.added(db, { offeringId, lecturerId });
      if (problem !== null) return err(problem);
    }
    await this.audit.record(db, actor, {
      action: "lecturing.assignment.created",
      resourceType: "course-offering",
      resourceId: offeringId,
      metadata: { assignmentId: row.id, lecturerId, role },
    });
    await boss.publish(
      "lecturing.assignment.created",
      { offeringId, assignmentId: row.id, lecturerId, role },
      { occurredAt: now, actorUserId: actor.userId },
    );
    return ok(row.id);
  }

  private async endIn(
    db: Database,
    boss: TxQueue,
    assignment: typeof schema.lecturerAssignments.$inferSelect,
    actor: AuditActor,
  ): Promise<void> {
    const la = schema.lecturerAssignments;
    const now = this.clock.now();
    await db
      .update(la)
      .set({
        status: "ENDED",
        endsOn: await this.settings.today(),
        updatedAt: now,
        version: sql`${la.version} + 1`,
      })
      .where(eq(la.id, assignment.id));
    for (const listener of this.listeners)
      await listener.ended(db, {
        offeringId: assignment.courseOfferingId,
        lecturerId: assignment.lecturerId,
      });
    await this.audit.record(db, actor, {
      action: "lecturing.assignment.ended",
      resourceType: "course-offering",
      resourceId: assignment.courseOfferingId,
      metadata: {
        assignmentId: assignment.id,
        lecturerId: assignment.lecturerId,
        role: assignment.role,
      },
    });
    await boss.publish(
      "lecturing.assignment.ended",
      {
        offeringId: assignment.courseOfferingId,
        assignmentId: assignment.id,
        lecturerId: assignment.lecturerId,
      },
      { occurredAt: now, actorUserId: actor.userId },
    );
  }
}

function invalid(field: string, message: string): DomainError {
  return domainError("VALIDATION_FAILED", message, {
    fieldErrors: [{ path: `body.${field}`, code: "invalid", message }],
  });
}
