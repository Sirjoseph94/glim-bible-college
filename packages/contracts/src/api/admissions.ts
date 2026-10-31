import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";
import { page, pageQuery } from "../pagination";
import {
  applicationQueueItemSchema,
  QUEUE_STATUSES,
  reviewedApplicationSchema,
} from "./applications";

const idParams = z.object({ id: z.uuid() });
const isoDate = z.iso.date();

export const intakeSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  opensOn: isoDate,
  closesOn: isoDate,
  /** When its cohort starts: no offering of the cohort may start before it (ADR-0005). */
  startsOn: isoDate,
  offerAcceptanceDays: z.number().int(),
  status: z.enum(ENUMS["intakes.status"]),
  version: z.number().int(),
});

export type Intake = z.infer<typeof intakeSchema>;

export const listIntakes = endpoint({
  method: "GET",
  path: "/intakes",
  summary: "Intakes, newest first",
  tag: "Admissions",
  auth: "session",
  permission: "admissions:intake:manage",
  response: z.object({ items: z.array(intakeSchema) }),
});

export const createIntake = endpoint({
  method: "POST",
  path: "/intakes",
  summary:
    "Plan an intake: its application dates (not overlapping another intake's) and its cohort's start date",
  tag: "Admissions",
  auth: "session",
  permission: "admissions:intake:manage",
  body: z
    .object({
      code: z
        .string()
        .trim()
        .regex(/^\d{4}(-[A-Za-z0-9]{1,10})?$/, "Use the start year, e.g. 2027 or 2027-JAN"),
      opensOn: isoDate,
      closesOn: isoDate,
      startsOn: isoDate,
      offerAcceptanceDays: z.number().int().min(1).max(90).default(21),
    })
    .strict(),
  response: intakeSchema,
});

export const updateIntake = endpoint({
  method: "PATCH",
  path: "/intakes/:id",
  summary: "Change an intake's dates or offer deadline",
  tag: "Admissions",
  auth: "session",
  permission: "admissions:intake:manage",
  resource: { type: "intake", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      opensOn: isoDate.optional(),
      closesOn: isoDate.optional(),
      startsOn: isoDate.optional(),
      offerAcceptanceDays: z.number().int().min(1).max(90).optional(),
    })
    .strict(),
  response: intakeSchema,
});

const intakeTransition = (action: "open" | "close", summary: string) =>
  endpoint({
    method: "POST",
    path: `/intakes/:id/${action}`,
    summary,
    tag: "Admissions",
    auth: "session",
    permission: "admissions:intake:manage",
    resource: { type: "intake", param: "id" },
    params: idParams,
    response: intakeSchema,
    successStatus: 200,
  });

export const openIntake = intakeTransition(
  "open",
  "Open the intake now, ahead of its opening date",
);
export const closeIntake = intakeTransition(
  "close",
  "Close the intake now, ahead of its closing date",
);

export const publicProgrammeSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
});

export const currentIntakeSchema = z.object({
  /** The open intake, else the next planned one, else the most recent closed one; null if none. */
  intake: z
    .object({
      code: z.string(),
      opensOn: isoDate,
      closesOn: isoDate,
      startsOn: isoDate,
      status: z.enum(ENUMS["intakes.status"]),
    })
    .nullable(),
  programmes: z.array(publicProgrammeSchema),
  statementOfFaithUrl: z.string().nullable(),
});

export type CurrentIntake = z.infer<typeof currentIntakeSchema>;

export const getCurrentIntake = endpoint({
  method: "GET",
  path: "/public/intakes/current",
  summary: "What an applicant needs before starting: programmes, intake dates, Statement of Faith",
  tag: "Public",
  auth: "public",
  response: currentIntakeSchema,
});

const queueStatus = z.enum(QUEUE_STATUSES as [string, ...string[]]);

export const listApplications = endpoint({
  method: "GET",
  path: "/admissions/applications",
  summary: "The officers' queue: submitted applications, oldest first",
  tag: "Admissions",
  auth: "session",
  permission: "admissions:application:read",
  query: pageQuery.extend({
    intakeId: z.uuid().optional(),
    status: queueStatus.optional(),
    programmeId: z.uuid().optional(),
    studyMode: z.enum(ENUMS["applications.study_mode"]).optional(),
    /** Name or Application Reference No. */
    q: z.string().trim().min(1).max(100).optional(),
  }),
  response: page(applicationQueueItemSchema),
});

const reviewResource = {
  auth: "session",
  resource: { type: "application", param: "id" },
  params: idParams,
  response: reviewedApplicationSchema,
} as const;

export const getReviewedApplication = endpoint({
  ...reviewResource,
  method: "GET",
  path: "/admissions/applications/:id",
  summary:
    "Every section of a submitted application (spiritual background only with read-sensitive)",
  tag: "Admissions",
  permission: "admissions:application:read",
});

export const startReview = endpoint({
  ...reviewResource,
  method: "POST",
  path: "/admissions/applications/:id/review",
  summary: "Mark a submitted application Under Review (opening it does this)",
  tag: "Admissions",
  permission: "admissions:application:decide",
  successStatus: 200,
});

export const addApplicationNote = endpoint({
  ...reviewResource,
  method: "POST",
  path: "/admissions/applications/:id/notes",
  summary: "Record an internal note, e.g. from an interview",
  tag: "Admissions",
  permission: "admissions:application:decide",
  body: z.object({ note: z.string().trim().min(1).max(2000) }).strict(),
  successStatus: 200,
});

export const decideApplication = endpoint({
  ...reviewResource,
  method: "POST",
  path: "/admissions/applications/:id/decide",
  summary: "Admit or reject an application under review; the applicant is emailed",
  tag: "Admissions",
  permission: "admissions:application:decide",
  idempotent: true,
  body: z
    .object({
      decision: z.enum(["ADMIT", "REJECT"]),
      /** Internal; never sent to the applicant. */
      note: z.string().trim().max(2000).optional(),
    })
    .strict(),
  successStatus: 200,
});

export const reopenOffer = endpoint({
  ...reviewResource,
  method: "POST",
  path: "/admissions/applications/:id/reopen-offer",
  summary: "Reopen a lapsed offer with a new deadline; a reason is required",
  tag: "Admissions",
  permission: "admissions:application:decide",
  body: z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
  successStatus: 200,
});

/** One application per row for the export (§10.5); section 5 only when asked for and allowed. */
export const exportRowSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

export const exportApplications = endpoint({
  method: "GET",
  path: "/admissions/applications/export",
  summary:
    "Every submitted application as rows; includeSensitive adds spiritual background (read-sensitive only, audited)",
  tag: "Admissions",
  auth: "session",
  permission: "admissions:application:read",
  query: z.object({
    intakeId: z.uuid().optional(),
    includeSensitive: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    format: z.enum(["json", "csv"]).default("csv"),
  }),
  response: z.object({ items: z.array(exportRowSchema) }),
});
