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
  academicSessionId: string;
  academicSessionName: string;
  opensOn: string;
  closesOn: string;
  offerAcceptanceDays: number;
  status: IntakeStatus;
  version: number;
}

export interface CurrentIntake {
  intake: Pick<
    IntakeView,
    "code" | "academicSessionName" | "opensOn" | "closesOn" | "status"
  > | null;
  programmes: {
    id: string;
    code: string;
    name: string;
    awardType: string;
    levels: number;
    durationSemesters: number;
  }[];
  statementOfFaithUrl: string | null;
}

const notFound = () => err(domainError("NOT_FOUND", "Not found."));

/** The yearly intake (owner: admissions, TRD §10.1, C-33): PLANNED → OPEN → CLOSED. */
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
        awardType: schema.programmes.awardType,
        levels: schema.programmes.levels,
        durationSemesters: schema.programmes.durationSemesters,
      })
      .from(schema.programmes)
      .where(eq(schema.programmes.status, "ACTIVE"))
      .orderBy(asc(schema.programmes.levels), asc(schema.programmes.code));
    const settings = await this.settings.get();
    return {
      intake:
        intake === undefined
          ? null
          : {
              code: intake.code,
              academicSessionName: intake.academicSessionName,
              opensOn: intake.opensOn,
              closesOn: intake.closesOn,
              status: intake.status,
            },
      programmes,
      statementOfFaithUrl: settings.statementOfFaithUrl,
    };
  }

  create(
    input: {
      code: string;
      academicSessionId: string;
      opensOn: string;
      closesOn: string;
      offerAcceptanceDays: number;
    },
    actor: AuditActor,
  ): Promise<DomainResult<IntakeView>> {
    if (input.closesOn <= input.opensOn) {
      return Promise.resolve(
        err(domainError("VALIDATION_FAILED", "The intake must close after it opens.")),
      );
    }
    return this.guarded(async (db) => {
      const [session] = await db
        .select({ startsOn: schema.academicSessions.startsOn })
        .from(schema.academicSessions)
        .where(eq(schema.academicSessions.id, input.academicSessionId));
      if (session === undefined) {
        return err(
          domainError("VALIDATION_FAILED", "That Academic Session doesn't exist.", {
            fieldErrors: [
              {
                path: "body.academicSessionId",
                code: "not_found",
                message: "That Academic Session doesn't exist.",
              },
            ],
          }),
        );
      }
      if (input.closesOn >= session.startsOn) {
        return err(
          domainError(
            "VALIDATION_FAILED",
            "Applications must close before the Academic Session starts.",
          ),
        );
      }
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
    change: Patch<{ opensOn: string; closesOn: string; offerAcceptanceDays: number }>,
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
      if (pg?.code === PG.UNIQUE_VIOLATION) {
        return err(
          domainError("CONFLICT", "That intake code or Academic Session already has an intake."),
        );
      }
      if (pg?.code === PG.CHECK_VIOLATION)
        return err(domainError("VALIDATION_FAILED", "The intake must close after it opens."));
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
    const s = schema.academicSessions;
    const rows = await db
      .select({ intake: i, sessionName: s.name })
      .from(i)
      .innerJoin(s, eq(s.id, i.academicSessionId))
      .where(where)
      .orderBy(...order);
    return rows.map((r) => ({
      id: r.intake.id,
      code: r.intake.code,
      academicSessionId: r.intake.academicSessionId,
      academicSessionName: r.sessionName,
      opensOn: r.intake.opensOn,
      closesOn: r.intake.closesOn,
      offerAcceptanceDays: r.intake.offerAcceptanceDays,
      status: r.intake.status as IntakeStatus,
      version: r.intake.version,
    }));
  }
}
