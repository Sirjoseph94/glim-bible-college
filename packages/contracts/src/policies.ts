import { z } from "zod";

const basisPoints = z.number().int().min(0).max(10_000);
const minutes = z
  .number()
  .int()
  .min(0)
  .max(24 * 60);

/** Attendance computation (TRD §12.2). Ratios are basis points (INV-14). */
export const attendancePolicy = z
  .object({
    basis: z.enum(["SCHEDULED", "ACTUAL", "ACTUAL_CAPPED"]).default("ACTUAL_CAPPED"),
    presentThresholdBp: basisPoints.default(7500),
    partialThresholdBp: basisPoints.default(2500),
    lateGraceMinutes: minutes.default(15),
    windowPaddingMinutes: z
      .object({ before: minutes.default(0), after: minutes.default(0) })
      .strict()
      .default({ before: 0, after: 0 }),
    minSegmentSeconds: z.number().int().min(0).max(3600).default(0),
    shortConferenceReviewBp: basisPoints.default(3000),
    unmatchedReviewMinutes: minutes.default(10),
    finalizeDelayMinutes: minutes.default(10),
    lockAfterDays: z.number().int().min(0).max(365).default(7),
    rollCallOpensBeforeMinutes: minutes.default(15),
  })
  .strict()
  .refine((p) => p.partialThresholdBp <= p.presentThresholdBp, {
    message: "The partial threshold can't be above the present threshold.",
    path: ["partialThresholdBp"],
  });

/** When people may join a Class Meeting (TRD §11.6, §11.4). */
export const joinWindowPolicy = z
  .object({
    studentOpensBeforeMinutes: minutes.default(15),
    studentClosesAfterMinutes: minutes.default(60),
    staffOpensBeforeMinutes: minutes.default(60),
    maxOverrunMinutes: minutes.default(180),
  })
  .strict();

/** What students are told about recordings (TRD §19.5, D-08) and how videos are shown (§13.4). */
export const recordingPolicy = z
  .object({
    noticeText: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .default(
        "Class Meetings are recorded. Recordings are published on GLIM's YouTube channel as unlisted videos: anyone with the link can watch them. Lecturers keep the camera on themselves and the slides where possible.",
      ),
    showDataSaverTip: z.boolean().default(true),
    /** A newly added video is published straight away (TRD §13.3). */
    autoPublish: z.boolean().default(true),
    restoreWindowDays: z.number().int().min(1).max(30).default(7),
  })
  .strict();

/** Notification delivery (TRD §15.1). Times are in the recipient's timezone. */
export const notificationPolicy = z
  .object({
    meetingReminderMinutes: minutes.default(15),
    quietHoursStart: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default("21:00"),
    quietHoursEnd: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default("06:00"),
  })
  .strict();

/** Admissions texts and rules (TRD §10). The text versions shown are stored with each application. */
export const admissionsPolicy = z
  .object({
    declarationText: z
      .string()
      .trim()
      .min(1)
      .max(5000)
      .default(
        "I declare that the information I have given is true and complete. I understand that false information may lead to my application being rejected or my admission being withdrawn.",
      ),
    consentText: z
      .string()
      .trim()
      .min(1)
      .max(5000)
      .default(
        "I consent to GLIM Online Bible College processing the personal data in this application to assess it and, if I am admitted, to run my studies, in line with the Nigeria Data Protection Act 2023.",
      ),
    offerReminderDaysBefore: z.array(z.number().int().min(1).max(30)).max(5).default([7, 2]),
    minimumAgeYears: z.number().int().min(16).max(99).default(18),
    purgeAfterMonths: z.number().int().min(1).max(120).default(12),
  })
  .strict();

/** Results defaults (TRD §14.4, D-02). CGPA thresholds are hundredths (INV-14). */
export const gradingDefaultsPolicy = z
  .object({
    repeatPolicy: z.enum(["KEEP_ALL", "REPLACE_LATEST", "BEST"]).default("BEST"),
    goodStandingMinCgpaX100: z.number().int().min(0).max(500).default(100),
    /** At finalization, a missing grade in a counted column scores 0 (§14.3). */
    missingGradeAsZero: z.boolean().default(true),
    /** Round the final percentage to a whole number before banding (§14.3: 69.50 ⇒ 70 ⇒ A). */
    roundBeforeBanding: z.enum(["NONE", "INTEGER"]).default("INTEGER"),
  })
  .strict();

/** The policies v1 edits. GOOGLE_MEET and RETENTION belong to later slices. */
export const POLICY_SCHEMAS = {
  ATTENDANCE: attendancePolicy,
  JOIN_WINDOW: joinWindowPolicy,
  RECORDING: recordingPolicy,
  NOTIFICATION: notificationPolicy,
  ADMISSIONS: admissionsPolicy,
  GRADING_DEFAULTS: gradingDefaultsPolicy,
} as const;

export type EditablePolicyType = keyof typeof POLICY_SCHEMAS;
export const EDITABLE_POLICY_TYPES = Object.keys(POLICY_SCHEMAS) as EditablePolicyType[];
export type PolicyConfig<T extends EditablePolicyType> = z.infer<(typeof POLICY_SCHEMAS)[T]>;

/** A policy's configuration when nobody has set one yet. */
export function defaultPolicy<T extends EditablePolicyType>(type: T): PolicyConfig<T> {
  return POLICY_SCHEMAS[type].parse({}) as PolicyConfig<T>;
}
