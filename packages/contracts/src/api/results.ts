import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

/**
 * Grading schemes (TRD §14.4, C-11, C-31): letter bands, repeat policy, standing and award
 * classes. All figures are integers in hundredths (`X100`): 7000 is 70.00 %, 450 is a CGPA of
 * 4.50.
 */

const idParams = z.object({ id: z.uuid() });
const hundredths = (max: number) => z.number().int().min(0).max(max);

export const gradeBandSchema = z
  .object({
    minX100: hundredths(10_000),
    maxX100: hundredths(10_000),
    letter: z.string().trim().min(1).max(4),
    pointsX100: hundredths(1000),
    pass: z.boolean(),
  })
  .strict();

export const classBandSchema = z
  .object({
    minCgpaX100: hundredths(1000),
    maxCgpaX100: hundredths(1000),
    label: z.string().trim().min(1).max(60),
  })
  .strict();

const schemeRules = {
  name: z.string().trim().min(1).max(100),
  kind: z.enum(ENUMS["grading_schemes.kind"]),
  bands: z.array(gradeBandSchema).min(1).max(20),
  classBands: z.array(classBandSchema).max(10),
  minAwardCgpaX100: hundredths(1000),
  maxPointsX100: z.number().int().min(1).max(1000),
  passMarkX100: hundredths(10_000),
  repeatPolicy: z.enum(ENUMS["grading_schemes.repeat_policy"]),
  goodStandingCgpaX100: hundredths(1000),
  probationCgpaX100: hundredths(1000).nullable(),
};

export const gradingSchemeSchema = z.object({
  id: z.uuid(),
  ...schemeRules,
  supersedesId: z.uuid().nullable(),
  /** Set once a result has used it: then it can't change, only be replaced by a new version. */
  lockedAt: z.iso.datetime().nullable(),
  /** The programmes graded with it. */
  programmes: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string() })),
  version: z.number().int(),
});

export type GradingScheme = z.infer<typeof gradingSchemeSchema>;

export const listGradingSchemes = endpoint({
  method: "GET",
  path: "/grading-schemes",
  summary: "Every grading scheme, newest versions first, with the programmes using each",
  tag: "Results",
  auth: "session",
  permission: "results:scheme:manage",
  response: z.object({ items: z.array(gradingSchemeSchema) }),
});

export const createGradingScheme = endpoint({
  method: "POST",
  path: "/grading-schemes",
  summary:
    "Create a scheme; with `supersedesId` it's a new version and the old one's programmes move to it",
  tag: "Results",
  auth: "session",
  permission: "results:scheme:manage",
  idempotent: true,
  body: z.object({ ...schemeRules, supersedesId: z.uuid().optional() }).strict(),
  response: gradingSchemeSchema,
  successStatus: 201,
});

export const updateGradingScheme = endpoint({
  method: "PATCH",
  path: "/grading-schemes/:id",
  summary: "Change a scheme no result has used yet (SCHEME_LOCKED once used)",
  tag: "Results",
  auth: "session",
  permission: "results:scheme:manage",
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      name: schemeRules.name.optional(),
      kind: schemeRules.kind.optional(),
      bands: schemeRules.bands.optional(),
      classBands: schemeRules.classBands.optional(),
      minAwardCgpaX100: schemeRules.minAwardCgpaX100.optional(),
      maxPointsX100: schemeRules.maxPointsX100.optional(),
      passMarkX100: schemeRules.passMarkX100.optional(),
      repeatPolicy: schemeRules.repeatPolicy.optional(),
      goodStandingCgpaX100: schemeRules.goodStandingCgpaX100.optional(),
      probationCgpaX100: schemeRules.probationCgpaX100.optional(),
    })
    .strict(),
  response: gradingSchemeSchema,
});

export const setProgrammeScheme = endpoint({
  method: "PUT",
  path: "/programmes/:id/grading-scheme",
  summary: "Choose the scheme a programme's future results are graded with",
  tag: "Results",
  auth: "session",
  permission: "results:scheme:manage",
  params: idParams,
  body: z.object({ gradingSchemeId: z.uuid() }).strict(),
  response: gradingSchemeSchema,
});
