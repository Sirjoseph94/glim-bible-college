import type { EnumValue } from "@glim/contracts";
import { Db, PG, pgError, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { SettingsService } from "@glim/modules/identity";
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
import { and, asc, desc, eq, lt, lte, ne, sql } from "drizzle-orm";

export type IntakeStatus = EnumValue<"intakes.status">;

export interface IntakeView {
  id: string;
  code: string;
  opensOn: string;
  closesOn: string;
  startsOn: string;
  offerAcceptanceDays: number;
  status: IntakeStatus;
  version: number;
}

export interface CurrentIntake {
  intake: Pick<IntakeView, "code" | "opensOn" | "closesOn" | "startsOn" | "status"> | null;
  programmes: { id: string; code: string; name: string }[];
  statementOfFaithUrl: string | null;
}

const notFound = () => err(domainError("NOT_FOUND", "Not found."));

/**
 * Intakes (owner: admissions, TRD §10.1, ADR-0005): PLANNED → OPEN → CLOSED. Each has its own
 * application window, never overlapping another's, and the date its cohort starts.
 */
@Injectable()
export class IntakesService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  list(): Promise<IntakeView[]> {
    return this.query(undefined, [desc(schema.intakes.opensOn)]);
  }

  async get(id: string): Promise<IntakeView | null> {
    const [row] = await this.query(eq(schema.intakes.id, id));
    return row ?? null;
  }

  /** The intake applicants see: the open one, else the next planned, else the latest closed. */
  async current(): Promise<CurrentIntake> {
    const i = schema.intakes;
    const [open] = await this.query(eq(i.status, "OPEN"), [asc(i.opensOn)]);
    const [planned] = open ? [] : await this.query(eq(i.status, "PLANNED"), [asc(i.opensOn)]);
    const [closed] =
      (open ?? planned) ? [] : await this.query(eq(i.status, "CLOSED"), [desc(i.closesOn)]);
    const intake = open ?? planned ?? closed;
    const programmes = await this.db.read
      .select({
        id: schema.programmes.id,
        code: schema.programmes.code,
        name: schema.programmes.name,
      })
      .from(schema.programmes)
      .where(eq(schema.programmes.status, "ACTIVE"))
      .orderBy(asc(schema.programmes.code));
    const settings = await this.settings.get();
    return {
      intake:
        intake === undefined
          ? null
          : {
              code: intake.code,
              opensOn: intake.opensOn,
              closesOn: intake.closesOn,
              startsOn: intake.startsOn,
              status: intake.status,
            },
      programmes,
      statementOfFaithUrl: settings.statementOfFaithUrl,
    };
  }

  create(
    input: {
      code: string;
      opensOn: string;
      closesOn: string;
      startsOn: string;
      offerAcceptanceDays: number;
    },
    actor: AuditActor,
  ): Promise<DomainResult<IntakeView>> {
    const invalid = checkDates(input);
    if (invalid !== null) return Promise.resolve(err(invalid));
    return this.guarded(async (db) => {
      const now = this.clock.now();
      const [row] = await db
        .insert(schema.intakes)
        .values({ ...input, createdAt: now, updatedAt: now })
        .returning({ id: schema.intakes.id });
      if (row === undefined) throw new Error("Intake insert returned no row");
      await this.audit.record(db, actor, {
        action: "admissions.intake.created",
        resourceType: "intake",
        resourceId: row.id,
        metadata: { code: input.code },
      });
      return this.view(db, row.id);
    });
  }

  update(
    id: string,
    expectedVersion: number,
    change: Patch<{
      opensOn: string;
      closesOn: string;
      startsOn: string;
      offerAcceptanceDays: number;
    }>,
    actor: AuditActor,
  ): Promise<DomainResult<IntakeView>> {
    return this.guarded(async (db) => {
      const i = schema.intakes;
      const [current] = await db.select().from(i).where(eq(i.id, id)).for("update");
      if (current === undefined) return notFound();
      if (current.version !== expectedVersion)
        return err(
          domainError(
            "VERSION_MISMATCH",
            "Someone else changed this intake. Reload and try again.",
          ),
        );
      if (current.status === "CLOSED")
        return err(domainError("CONFLICT", "A closed intake can't change."));
      const fields = definedFields(change);
      const invalid = checkDates({
        opensOn: change.opensOn ?? current.opensOn,
        closesOn: change.closesOn ?? current.closesOn,
        startsOn: change.startsOn ?? current.startsOn,
      });
      if (invalid !== null) return err(invalid);
      if (change.startsOn !== undefined && change.startsOn > current.startsOn) {
        // The cohort's offerings may not start before it does (ADR-0005).
        const o = schema.courseOfferings;
        const [early] = await db
          .select({ id: o.id })
          .from(o)
          .innerJoin(schema.cohorts, eq(schema.cohorts.id, o.cohortId))
          .where(
            and(
              eq(schema.cohorts.intakeId, id),
              ne(o.status, "CANCELLED"),
              lt(o.startsOn, change.startsOn),
            ),
          )
          .limit(1);
        if (early !== undefined)
          return err(
            domainError(
              "BEFORE_INTAKE_START",
              "This intake's cohort has offerings starting before that date. Move them first.",
            ),
          );
      }
      await db
        .update(i)
        .set({ ...fields, updatedAt: this.clock.now(), version: sql`${i.version} + 1` })
        .where(eq(i.id, id));
      await this.audit.record(db, actor, {
        action: "admissions.intake.updated",
        resourceType: "intake",
        resourceId: id,
        metadata: fields,
      });
      return this.view(db, id);
    });
  }

  /** Manual override: open now (from PLANNED) or close now (from PLANNED or OPEN). */
  transition(
    id: string,
    to: "OPEN" | "CLOSED",
    actor: AuditActor,
  ): Promise<DomainResult<IntakeView>> {
    return this.guarded(async (db) => {
      const i = schema.intakes;
      const [current] = await db.select().from(i).where(eq(i.id, id)).for("update");
      if (current === undefined) return notFound();
      const allowed = to === "OPEN" ? current.status === "PLANNED" : current.status !== "CLOSED";
      if (!allowed)
        return err(domainError("CONFLICT", `The intake is ${current.status.toLowerCase()}.`));
      await this.setStatus(db, id, to);
      await this.audit.record(db, actor, {
        action: to === "OPEN" ? "admissions.intake.opened" : "admissions.intake.closed",
        resourceType: "intake",
        resourceId: id,
        metadata: { from: current.status, manual: true },
      });
      return this.view(db, id);
    });
  }

  /**
   * The daily job (`admissions.intake-status`): moves intakes forward by today's date in the
   * institution's timezone. It never moves one back, so a manual early open or close sticks.
   */
  async syncStatuses(actor: AuditActor): Promise<{ opened: number; closed: number }> {
    const today = await this.settings.today();
    return this.db.withTx(async ({ db }) => {
      const i = schema.intakes;
      const closed = await db
        .update(i)
        .set({ status: "CLOSED", updatedAt: this.clock.now(), version: sql`${i.version} + 1` })
        .where(and(ne(i.status, "CLOSED"), lt(i.closesOn, today)))
        .returning({ id: i.id });
      const opened = await db
        .update(i)
        .set({ status: "OPEN", updatedAt: this.clock.now(), version: sql`${i.version} + 1` })
        .where(and(eq(i.status, "PLANNED"), lte(i.opensOn, today)))
        .returning({ id: i.id });
      for (const { id } of opened) {
        await this.audit.record(db, actor, {
          action: "admissions.intake.opened",
          resourceType: "intake",
          resourceId: id,
          metadata: { manual: false, on: today },
        });
      }
      for (const { id } of closed) {
        await this.audit.record(db, actor, {
          action: "admissions.intake.closed",
          resourceType: "intake",
          resourceId: id,
          metadata: { manual: false, on: today },
        });
      }
      return { opened: opened.length, closed: closed.length };
    });
  }

  private async guarded(
    fn: (db: Database) => Promise<DomainResult<IntakeView>>,
  ): Promise<DomainResult<IntakeView>> {
    try {
      return await this.db.withTxResult(({ db }) => fn(db));
    } catch (error) {
      const pg = pgError(error);
      if (pg?.code === PG.UNIQUE_VIOLATION)
        return err(domainError("CONFLICT", "There's already an intake with that code."));
      if (pg?.code === PG.EXCLUSION_VIOLATION)
        return err(
          domainError(
            "INTAKE_OVERLAP",
            "Another intake takes applications on some of those days. Intakes' application dates can't overlap.",
          ),
        );
      if (pg?.code === PG.CHECK_VIOLATION)
        return err(domainError("VALIDATION_FAILED", "The intake's dates don't fit together."));
      throw error;
    }
  }

  private async setStatus(db: Database, id: string, status: IntakeStatus): Promise<void> {
    const i = schema.intakes;
    await db
      .update(i)
      .set({ status, updatedAt: this.clock.now(), version: sql`${i.version} + 1` })
      .where(eq(i.id, id));
  }

  private async view(db: Database, id: string): Promise<DomainResult<IntakeView>> {
    const [row] = await this.query(eq(schema.intakes.id, id), undefined, db);
    return row === undefined ? notFound() : ok(row);
  }

  private async query(
    where: ReturnType<typeof eq> | undefined,
    order: ReturnType<typeof asc>[] = [desc(schema.intakes.opensOn)],
    db: Database = this.db.read,
  ): Promise<IntakeView[]> {
    const i = schema.intakes;
    const rows = await db
      .select()
      .from(i)
      .where(where)
      .orderBy(...order);
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      opensOn: r.opensOn,
      closesOn: r.closesOn,
      startsOn: r.startsOn,
      offerAcceptanceDays: r.offerAcceptanceDays,
      status: r.status as IntakeStatus,
      version: r.version,
    }));
  }
}

/** Applications close after they open, and the cohort can't start before they open. */
function checkDates(dates: { opensOn: string; closesOn: string; startsOn: string }) {
  if (dates.closesOn <= dates.opensOn)
    return domainError("VALIDATION_FAILED", "The intake must close after it opens.");
  if (dates.startsOn < dates.opensOn)
    return domainError(
      "VALIDATION_FAILED",
      "The cohort can't start before the intake opens for applications.",
    );
  return null;
}
