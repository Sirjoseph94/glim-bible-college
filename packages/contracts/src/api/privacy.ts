import { z } from "zod";
import { endpoint } from "../http";

/** Data subject requests (TRD §19.4, NDPA 2023). */

export const dataExportSchema = z.object({
  exportedAt: z.iso.datetime(),
  userId: z.uuid(),
  note: z.string(),
  /** By area: account, sign-in methods, applications, student record, results, … */
  sections: z.record(z.string(), z.unknown()),
});

export type DataExport = z.infer<typeof dataExportSchema>;

export const getDataExport = endpoint({
  method: "GET",
  path: "/me/data-export",
  summary: "Everything GLIM holds about the caller, as JSON (their own application answers too)",
  tag: "Me",
  auth: "session",
  response: dataExportSchema,
});

export const eraseUser = endpoint({
  method: "POST",
  path: "/users/:id/erase",
  summary:
    "Erase a person: personal details removed or anonymised, academic records kept under a pseudonym (audited)",
  tag: "Users",
  auth: "session",
  permission: "identity:user:erase",
  params: z.object({ id: z.uuid() }),
  body: z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
  response: z.object({ pseudonym: z.string() }),
  successStatus: 200,
});
