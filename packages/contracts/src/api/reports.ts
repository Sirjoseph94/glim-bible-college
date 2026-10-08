import { z } from "zod";
import { endpoint } from "../http";

/** Admissions reports (TRD §10.6), as JSON or (`format=csv`) a CSV download. */

const reportQuery = z.object({
  intakeId: z.uuid().optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

const count = z.object({ key: z.string(), label: z.string(), count: z.number().int() });

export const admissionsReportSchema = z.object({
  intake: z.object({ id: z.uuid(), code: z.string() }).nullable(),
  /** Submitted applications (drafts are counted separately). */
  total: z.number().int(),
  draftsInProgress: z.number().int(),
  byStatus: z.array(count),
  byProgramme: z.array(count),
  byStudyMode: z.array(count),
  byCountry: z.array(count),
  byHeardVia: z.array(count),
});

export type AdmissionsReport = z.infer<typeof admissionsReportSchema>;

const referredApplication = z.object({
  referenceNo: z.string(),
  applicantName: z.string(),
  programmeName: z.string(),
  status: z.string(),
});

export const referralReportSchema = z.object({
  intake: z.object({ id: z.uuid(), code: z.string() }).nullable(),
  referrers: z.array(
    z.object({
      userId: z.uuid(),
      name: z.string(),
      code: z.string(),
      total: z.number().int(),
      admitted: z.number().int(),
      accepted: z.number().int(),
      applications: z.array(referredApplication),
    }),
  ),
  /** Codes that matched nobody, with the applications that entered them. */
  unmatched: z.array(z.object({ code: z.string(), applications: z.array(referredApplication) })),
});

export type ReferralReport = z.infer<typeof referralReportSchema>;

export const getAdmissionsReport = endpoint({
  method: "GET",
  path: "/reports/admissions",
  summary: "Applications by status, programme, study mode, country and how they heard about us",
  tag: "Reports",
  auth: "session",
  permission: "admissions:report:read",
  query: reportQuery,
  response: admissionsReportSchema,
});

export const getReferralReport = endpoint({
  method: "GET",
  path: "/reports/referrals",
  summary: "Each referrer with the applications that named them, and their outcomes",
  tag: "Reports",
  auth: "session",
  permission: "admissions:report:read",
  query: reportQuery,
  response: referralReportSchema,
});
