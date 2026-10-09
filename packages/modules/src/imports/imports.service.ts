import { createHash } from "node:crypto";
import type { ImportJob, ImportKind } from "@glim/contracts";
import { Db, pgError, schema, withSavepoint, type Database, type ImportStats } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { FilesService } from "@glim/modules/content";
import { UserService } from "@glim/modules/identity";
import {
  CLOCK,
  domainError,
  err,
  ok,
  parseCsv,
  toCsv,
  type Clock,
  type DomainResult,
} from "@glim/shared";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { IMPORT_KIND_SPECS, RowError, type RowOutcome } from "./import-kinds";

type JobRow = typeof schema.importJobs.$inferSelect;

/** Rows per transaction (TRD §15.2). */
export const IMPORT_BATCH_SIZE = 200;
/** Invites go out at about this many a second, spread with `startAfter` (rate cap). */
const INVITES_PER_SECOND = 20;

const EMPTY_STATS: ImportStats = {
  total: 0,
  valid: 0,
  invalid: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failure: null,
};

/** Thrown to roll back a dry-run batch once its rows have been tried. */
class DryRunRollback extends Error {}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * CSV imports for onboarding existing GLIM data (owner: imports, TRD §15.2, D-04). A dry run
 * applies every row in a transaction that is rolled back, so it reports exactly what a commit
 * would do; a commit applies batches of 200, each in its own transaction with `rows_done`, so a
 * retried job resumes where it stopped. Upserts are by natural key; row errors go to an error
 * CSV; imported users are invited (rate-capped) and get referral codes.
 */
@Injectable()
export class ImportsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(UserService) private readonly users: UserService,
  ) {}

  template(kind: ImportKind): string {
    const spec = IMPORT_KIND_SPECS[kind];
    return toCsv(spec.columns, [spec.example]);
  }

  /**
   * Queues a dry run, or a commit of a file whose dry run passed with the same contents
   * (`IMPORT_FILE_CHANGED` otherwise). The job is enqueued in the same transaction.
   */
  async start(
    input: { kind: ImportKind; fileId: string; dryRun: boolean },
    actor: AuditActor & { userId: string },
  ): Promise<DomainResult<ImportJob>> {
    const read = await this.files.read(input.fileId);
    if (read?.file.purpose !== "IMPORT")
      return err(
        domainError("VALIDATION_FAILED", "Upload the CSV file first.", {
          fieldErrors: [
            { path: "fileId", code: "invalid", message: "Not an uploaded import file." },
          ],
        }),
      );
    const fileSha256 = sha256(read.bytes);
    const j = schema.importJobs;
    if (!input.dryRun) {
      const [dryRun] = await this.db.read
        .select()
        .from(j)
        .where(
          and(
            eq(j.fileId, input.fileId),
            eq(j.kind, input.kind),
            eq(j.dryRun, true),
            eq(j.status, "COMPLETED"),
          ),
        )
        .orderBy(desc(j.createdAt))
        .limit(1);
      if (dryRun === undefined)
        return err(domainError("VALIDATION_FAILED", "Run a dry run of this file first."));
      if (dryRun.fileSha256 !== fileSha256)
        return err(
          domainError(
            "IMPORT_FILE_CHANGED",
            "The file has changed since its dry run. Run the dry run again.",
          ),
        );
    }
    const job = await this.db.withTx(async ({ db, boss }) => {
      const now = this.clock.now();
      const [row] = await db
        .insert(j)
        .values({
          kind: input.kind,
          fileId: input.fileId,
          fileSha256,
          dryRun: input.dryRun,
          stats: EMPTY_STATS,
          createdBy: actor.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (row === undefined) throw new Error("import insert returned nothing");
      await boss.send("import.run", { importJobId: row.id });
      await this.audit.record(db, actor, {
        action: "imports.import.started",
        resourceType: "import",
        resourceId: row.id,
        metadata: { kind: input.kind, dryRun: input.dryRun, fileId: input.fileId },
      });
      return row;
    });
    return ok(this.toView(job, read.file.originalName));
  }

  async list(): Promise<ImportJob[]> {
    const j = schema.importJobs;
    const rows = await this.db.read
      .select({ job: j, name: schema.files.originalName })
      .from(j)
      .innerJoin(schema.files, eq(schema.files.id, j.fileId))
      .orderBy(desc(j.createdAt))
      .limit(50);
    return rows.map((r) => this.toView(r.job, r.name));
  }

  async get(id: string): Promise<ImportJob | null> {
    const j = schema.importJobs;
    const [row] = await this.db.read
      .select({ job: j, name: schema.files.originalName })
      .from(j)
      .innerJoin(schema.files, eq(schema.files.id, j.fileId))
      .where(eq(j.id, id));
    return row === undefined ? null : this.toView(row.job, row.name);
  }

  /** The `import.run` job. Safe to retry: a commit resumes after its last committed batch. */
  async run(importJobId: string): Promise<ImportStats> {
    const j = schema.importJobs;
    const [job] = await this.db.read.select().from(j).where(eq(j.id, importJobId));
    if (job === undefined || job.status === "COMPLETED" || job.status === "FAILED")
      return job?.stats ?? EMPTY_STATS;
    await this.update(job.id, { status: "RUNNING" });

    const read = await this.files.read(job.fileId);
    if (read === null) return this.fail(job, "The uploaded file is no longer available.");
    if (sha256(read.bytes) !== job.fileSha256)
      return this.fail(job, "IMPORT_FILE_CHANGED: the file changed after this import started.");
    const [header = [], ...body] = parseCsv(new TextDecoder().decode(read.bytes));
    const columns = header.map((h) => h.trim().toLowerCase());
    const spec = IMPORT_KIND_SPECS[job.kind as ImportKind];
    const missing = spec.required.filter((c) => !columns.includes(c));
    if (missing.length > 0) return this.fail(job, `Missing columns: ${missing.join(", ")}`);
    const records = body.map((cells) =>
      Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? ""])),
    );

    // A resumed commit keeps the counts of the batches it already committed.
    const stats: ImportStats = job.rowsDone > 0 ? { ...job.stats } : { ...EMPTY_STATS };
    stats.total = records.length;
    const errors: { row: number; message: string }[] = [];
    let invites = 0;
    for (let start = job.rowsDone; start < records.length; start += IMPORT_BATCH_SIZE) {
      const batch = records.slice(start, start + IMPORT_BATCH_SIZE);
      const counted: ImportStats = { ...EMPTY_STATS };
      const batchErrors: typeof errors = [];
      try {
        await this.db.withTx(async ({ db, boss }) => {
          const now = this.clock.now();
          const createdUsers: string[] = [];
          const semesters = new Set<string>();
          for (const [offset, record] of batch.entries()) {
            const rowNumber = start + offset + 2; // header is row 1
            try {
              const outcome: RowOutcome = await withSavepoint(db, () =>
                spec.applyRow({ db, now, createdUsers, semesters }, record),
              );
              counted.valid++;
              counted[outcome]++;
            } catch (error) {
              if (!(error instanceof RowError) && !isDatabaseRowError(error)) throw error;
              counted.invalid++;
              batchErrors.push({ row: rowNumber, message: messageOf(error) });
            }
          }
          if (job.dryRun) throw new DryRunRollback();
          for (const userId of createdUsers) {
            await this.users.ensureReferralCode(db, userId);
            await boss.send(
              "identity.invite",
              { userId },
              { startAfter: Math.floor(invites++ / INVITES_PER_SECOND) },
            );
          }
          // Imported results change GPAs: recompute their semesters (and the CGPA after them).
          for (const semesterId of semesters)
            await boss.send("results.compute-semester", { semesterId });
          await this.saveProgress(db, job.id, start + batch.length, add(stats, counted));
        });
      } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
      }
      Object.assign(stats, add(stats, counted));
      errors.push(...batchErrors);
    }

    const errorFile =
      errors.length === 0
        ? null
        : await this.files.store({
            ownerUserId: job.createdBy,
            purpose: "IMPORT",
            name: `import-errors-${job.id}.csv`,
            mime: "text/csv",
            bytes: new TextEncoder().encode(
              toCsv(
                ["row", "errors", ...columns],
                errors.map((e) => [e.row, e.message, ...(body[e.row - 2] ?? [])]),
              ),
            ),
          });
    await this.db.withTx(async ({ db }) => {
      await db
        .update(j)
        .set({
          status: "COMPLETED",
          stats,
          rowsDone: records.length,
          errorFileId: errorFile?.id ?? null,
          updatedAt: this.clock.now(),
        })
        .where(eq(j.id, job.id));
      await this.audit.record(
        db,
        { userId: job.createdBy, type: "JOB" },
        {
          action: "imports.import.completed",
          resourceType: "import",
          resourceId: job.id,
          metadata: { kind: job.kind, dryRun: job.dryRun, ...stats },
        },
      );
    });
    this.logger.info(
      { importJobId: job.id, kind: job.kind, dryRun: job.dryRun, ...stats },
      "import finished",
    );
    return stats;
  }

  private async saveProgress(db: Database, id: string, rowsDone: number, stats: ImportStats) {
    await db
      .update(schema.importJobs)
      .set({ rowsDone, stats, updatedAt: this.clock.now() })
      .where(eq(schema.importJobs.id, id));
  }

  private async update(id: string, change: Partial<JobRow>) {
    await this.db.withTx(({ db }) =>
      db
        .update(schema.importJobs)
        .set({ ...change, updatedAt: this.clock.now() })
        .where(eq(schema.importJobs.id, id)),
    );
  }

  private async fail(job: JobRow, failure: string): Promise<ImportStats> {
    const stats = { ...job.stats, failure };
    await this.update(job.id, { status: "FAILED", stats });
    return stats;
  }

  private toView(job: JobRow, fileName: string): ImportJob {
    return {
      id: job.id,
      kind: job.kind as ImportJob["kind"],
      dryRun: job.dryRun,
      status: job.status as ImportJob["status"],
      fileName,
      stats: { ...EMPTY_STATS, ...job.stats },
      rowsDone: job.rowsDone,
      errorFile:
        job.errorFileId === null
          ? null
          : { downloadPath: `/api/v1/files/${job.errorFileId}/download` },
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }
}

function add(a: ImportStats, b: ImportStats): ImportStats {
  return {
    total: a.total,
    valid: a.valid + b.valid,
    invalid: a.invalid + b.invalid,
    created: a.created + b.created,
    updated: a.updated + b.updated,
    unchanged: a.unchanged + b.unchanged,
    failure: a.failure,
  };
}

/** A constraint the row broke (e.g. one active programme enrollment per student). */
function isDatabaseRowError(error: unknown): boolean {
  return pgError(error)?.code.startsWith("23") ?? false;
}

function messageOf(error: unknown): string {
  if (error instanceof RowError) return error.message;
  const constraint = pgError(error)?.constraint;
  return constraint === "one_active_programme_enrollment"
    ? "The student already has an active enrollment on this programme."
    : "This row conflicts with existing data.";
}
