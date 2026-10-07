import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

const idParams = z.object({ id: z.uuid() });
const isoDate = z.iso.date();

export const intakeSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  academicSessionId: z.uuid(),
  academicSessionName: z.string(),
  opensOn: isoDate,
  closesOn: isoDate,
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
  summary: "Plan the yearly intake for an Academic Session",
  tag: "Admissions",
  auth: "session",
  permission: "admissions:intake:manage",
  body: z
    .object({
      code: z
        .string()
        .trim()
        .regex(/^\d{4}$/, "Use the year students start, e.g. 2027"),
      academicSessionId: z.uuid(),
      opensOn: isoDate,
      closesOn: isoDate,
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
  awardType: z.enum(ENUMS["programmes.award_type"]),
  levels: z.number().int(),
  durationSemesters: z.number().int(),
});

export const currentIntakeSchema = z.object({
  /** The open intake, else the next planned one, else the most recent closed one; null if none. */
  intake: z
    .object({
      code: z.string(),
      academicSessionName: z.string(),
      opensOn: isoDate,
      closesOn: isoDate,
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
