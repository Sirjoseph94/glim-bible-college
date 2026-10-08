import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

/**
 * The applicant's own application (TRD §10.2): the online version of the paper form, section by
 * section. Drafts may leave anything empty; `missing` lists what submitting will still need.
 */

const idParams = z.object({ id: z.uuid() });
const isoDate = z.iso.date();

/** A draft answer: trimmed, with an empty string meaning "not answered yet". */
const answer = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
const phone = z
  .string()
  .trim()
  .regex(/^$|^\+?[0-9 ()-]{7,20}$/, "Use digits, with the country code, e.g. +234 803 123 4567")
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();
const choice = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).nullable().optional();
const yesNo = z.boolean().nullable().optional();

export const APPLICATION_SECTIONS = [
  "personal",
  "contact",
  "address",
  "church",
  "spiritual",
  "feedback",
  "declaration",
  "consent",
  "photo",
] as const;
export type ApplicationSection = (typeof APPLICATION_SECTIONS)[number];

/** What a draft save may change, one or more sections at a time. */
export const applicationDraftSchema = z
  .object({
    programmeId: z.uuid().optional(),
    studyMode: z.enum(ENUMS["applications.study_mode"]).optional(),
    personal: z
      .object({
        firstName: answer(),
        middleName: answer(),
        lastName: answer(),
        title: choice(ENUMS["applications.title"]),
        titleOther: answer(60),
        gender: choice(ENUMS["applications.gender"]),
        dateOfBirth: isoDate.nullable().optional(),
        maritalStatus: choice(ENUMS["applications.marital_status"]),
        nationality: answer(100),
        occupation: answer(),
      })
      .strict()
      .optional(),
    contact: z
      .object({
        email: z
          .union([z.literal(""), z.email().max(254)])
          .transform((v) => (v === "" ? null : v))
          .nullable()
          .optional(),
        phoneWhatsapp: phone,
        altPhoneWhatsapp: phone,
      })
      .strict()
      .optional(),
    address: z
      .object({
        country: answer(100),
        stateProvince: answer(100),
        city: answer(100),
        postcode: answer(20),
        address: answer(500),
      })
      .strict()
      .optional(),
    church: z
      .object({
        churchName: answer(),
        churchAddress: answer(500),
        pastorName: answer(),
        pastorPhone: phone,
      })
      .strict()
      .optional(),
    /** SENSITIVE (INV-15): stored, shown back to the applicant, never logged or audited. */
    spiritual: z
      .object({
        bornAgain: yesNo,
        bornAgainWhen: answer(),
        waterBaptism: answer(500),
        holySpiritBaptism: yesNo,
        holySpiritSince: answer(),
      })
      .strict()
      .optional(),
    feedback: z
      .object({
        heardVia: z
          .array(z.enum(ENUMS["applications.heard_via"]))
          .max(ENUMS["applications.heard_via"].length)
          .refine((v) => new Set(v).size === v.length, "Choose each option once.")
          .optional(),
        heardViaOther: answer(),
        referralCode: answer(20),
      })
      .strict()
      .optional(),
    /** The server records when the declaration was made; the applicant never sends a date. */
    declaration: z
      .object({
        fullName: answer(),
        statementOfFaithRead: z.boolean().optional(),
        declared: z.boolean().optional(),
      })
      .strict()
      .optional(),
    consent: z.object({ consented: z.boolean() }).strict().optional(),
    /** A completed PASSPORT_PHOTO upload of the applicant's own; null removes it. */
    photo: z.object({ fileId: z.uuid().nullable() }).strict().optional(),
  })
  .strict();

export type ApplicationDraft = z.input<typeof applicationDraftSchema>;

const str = z.string().nullable();

export const applicationSchema = z.object({
  id: z.uuid(),
  status: z.enum(ENUMS["applications.status"]),
  version: z.number().int(),
  referenceNo: str,
  intake: z.object({
    id: z.uuid(),
    code: z.string(),
    academicSessionName: z.string(),
    /** When the Academic Session starts: the date the minimum age is checked against. */
    startsOn: isoDate,
    closesOn: isoDate,
    status: z.enum(ENUMS["intakes.status"]),
  }),
  programme: z.object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    awardType: z.enum(ENUMS["programmes.award_type"]),
  }),
  studyMode: z.enum(ENUMS["applications.study_mode"]).nullable(),
  personal: z.object({
    firstName: str,
    middleName: str,
    lastName: str,
    title: z.enum(ENUMS["applications.title"]).nullable(),
    titleOther: str,
    gender: z.enum(ENUMS["applications.gender"]).nullable(),
    dateOfBirth: isoDate.nullable(),
    maritalStatus: z.enum(ENUMS["applications.marital_status"]).nullable(),
    nationality: str,
    occupation: str,
  }),
  contact: z.object({ email: str, phoneWhatsapp: str, altPhoneWhatsapp: str }),
  address: z.object({
    country: str,
    stateProvince: str,
    city: str,
    postcode: str,
    address: str,
  }),
  church: z.object({ churchName: str, churchAddress: str, pastorName: str, pastorPhone: str }),
  spiritual: z.object({
    bornAgain: z.boolean().nullable(),
    bornAgainWhen: str,
    waterBaptism: str,
    holySpiritBaptism: z.boolean().nullable(),
    holySpiritSince: str,
  }),
  feedback: z.object({
    heardVia: z.array(z.enum(ENUMS["applications.heard_via"])),
    heardViaOther: str,
    referralCode: str,
  }),
  declaration: z.object({
    fullName: str,
    statementOfFaithRead: z.boolean(),
    declaredAt: z.iso.datetime().nullable(),
  }),
  consent: z.object({ consentedAt: z.iso.datetime().nullable() }),
  photo: z.object({ fileId: z.uuid(), downloadPath: z.string() }).nullable(),
  /** Required fields still unanswered, per section; empty everywhere once ready to submit. */
  missing: z.record(z.enum(APPLICATION_SECTIONS), z.array(z.string())),
  /** The texts the applicant declares and consents to, and where to read the Statement of Faith. */
  texts: z.object({
    declarationText: z.string(),
    consentText: z.string(),
    statementOfFaithUrl: z.string().nullable(),
  }),
  minimumAgeYears: z.number().int(),
  submittedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});

export type Application = z.infer<typeof applicationSchema>;

export const applicationSummarySchema = applicationSchema.pick({
  id: true,
  status: true,
  referenceNo: true,
  intake: true,
  programme: true,
  studyMode: true,
  submittedAt: true,
  updatedAt: true,
});

export type ApplicationSummary = z.infer<typeof applicationSummarySchema>;

export const startApplication = endpoint({
  method: "POST",
  path: "/applications",
  summary: "Start an application to the open intake",
  tag: "Applications",
  auth: "session",
  rateLimit: "apply",
  body: z
    .object({
      programmeId: z.uuid(),
      studyMode: z.enum(ENUMS["applications.study_mode"]),
    })
    .strict(),
  response: applicationSchema,
  successStatus: 201,
});

export const myApplications = endpoint({
  method: "GET",
  path: "/applications/mine",
  summary: "The signed-in user's applications, newest first",
  tag: "Applications",
  auth: "session",
  response: z.object({ items: z.array(applicationSummarySchema) }),
});

export const getApplication = endpoint({
  method: "GET",
  path: "/applications/:id",
  summary: "The applicant's own application, every section",
  tag: "Applications",
  auth: "session",
  permission: "admissions:application:own-edit",
  resource: { type: "application", param: "id" },
  params: idParams,
  response: applicationSchema,
});

export const saveApplicationDraft = endpoint({
  method: "PATCH",
  path: "/applications/:id",
  summary: "Save draft answers (autosave), one or more sections at a time",
  tag: "Applications",
  auth: "session",
  permission: "admissions:application:own-edit",
  resource: { type: "application", param: "id" },
  ifMatch: true,
  params: idParams,
  body: applicationDraftSchema,
  response: applicationSchema,
});
