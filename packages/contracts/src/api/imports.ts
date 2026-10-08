import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

/**
 * Onboarding existing GLIM data from CSV (TRD §15.2, D-04): a dry run first, then a commit of the
 * same, unchanged file. Row errors come back as a downloadable CSV.
 */

/** Kinds v1 imports now; COURSE_RESULTS arrives with legacy results (ticket 39). */
export const IMPORT_KINDS = ["STUDENTS", "LECTURERS", "COURSE_ENROLLMENTS"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const importJobSchema = z.object({
  id: z.uuid(),
  kind: z.enum(ENUMS["import_jobs.kind"]),
  dryRun: z.boolean(),
  status: z.enum(ENUMS["import_jobs.status"]),
  fileName: z.string(),
  stats: z.object({
    total: z.number().int(),
    valid: z.number().int(),
    invalid: z.number().int(),
    created: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int(),
    /** Why the whole run failed (e.g. the file changed since the dry run). */
    failure: z.string().nullable(),
  }),
  rowsDone: z.number().int(),
  /** Each invalid row with its errors, as CSV. */
  errorFile: z.object({ downloadPath: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type ImportJob = z.infer<typeof importJobSchema>;

export const startImport = endpoint({
  method: "POST",
  path: "/imports",
  summary: "Check (dry run, the default) or commit an uploaded CSV",
  tag: "Imports",
  auth: "session",
  permission: "identity:import:run",
  idempotent: true,
  body: z
    .object({
      kind: z.enum(IMPORT_KINDS),
      fileId: z.uuid(),
      dryRun: z.boolean().default(true),
    })
    .strict(),
  response: importJobSchema,
  successStatus: 202,
});

export const listImports = endpoint({
  method: "GET",
  path: "/imports",
  summary: "Recent imports, newest first",
  tag: "Imports",
  auth: "session",
  permission: "identity:import:run",
  response: z.object({ items: z.array(importJobSchema) }),
});

export const getImport = endpoint({
  method: "GET",
  path: "/imports/:id",
  summary: "An import's progress and outcome",
  tag: "Imports",
  auth: "session",
  permission: "identity:import:run",
  params: z.object({ id: z.uuid() }),
  response: importJobSchema,
});

export const getImportTemplate = endpoint({
  method: "GET",
  path: "/imports/templates/:kind",
  summary: "A CSV template with the columns for a kind of import",
  tag: "Imports",
  auth: "session",
  permission: "identity:import:run",
  params: z.object({ kind: z.enum(IMPORT_KINDS) }),
  response: z.object({ columns: z.array(z.string()) }),
});
