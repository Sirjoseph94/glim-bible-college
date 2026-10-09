import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

/**
 * Transcripts (TRD §14.7, C-12): requested by students, issued by the Registrar as an immutable
 * snapshot anchored by its SHA-256, and verifiable by anyone with the code.
 */

const idParams = z.object({ id: z.uuid() });

export const transcriptCourseSchema = z.object({
  code: z.string(),
  title: z.string(),
  creditsX10: z.number().int(),
  finalPctX100: z.number().int().nullable(),
  letter: z.string().nullable(),
  pointsX100: z.number().int().nullable(),
  resultKind: z.enum(ENUMS["course_results.result_kind"]),
  attemptNo: z.number().int(),
  /** A later attempt replaced it in the CGPA (repeat policy). */
  repeated: z.boolean(),
  imported: z.boolean(),
});

export const transcriptSnapshotSchema = z.object({
  version: z.literal(1),
  kind: z.enum(ENUMS["transcripts.kind"]),
  asOf: z.iso.date(),
  institution: z.object({ name: z.string() }),
  programme: z.object({
    code: z.string(),
    name: z.string(),
    awardType: z.enum(ENUMS["programmes.award_type"]),
  }),
  student: z.object({ legalName: z.string(), matricNumber: z.string() }),
  semesters: z.array(
    z.object({
      sessionCode: z.string(),
      semesterName: z.string(),
      /** Not yet approved by the Registrar (unofficial transcripts only). */
      provisional: z.boolean(),
      courses: z.array(transcriptCourseSchema),
      creditsAttemptedX10: z.number().int(),
      creditsEarnedX10: z.number().int(),
      gpaX100: z.number().int().nullable(),
      cgpaX100: z.number().int().nullable(),
      standing: z.enum(ENUMS["semester_results.standing"]),
    }),
  ),
  totals: z.object({
    creditsAttemptedX10: z.number().int(),
    creditsEarnedX10: z.number().int(),
    cgpaX100: z.number().int().nullable(),
    standing: z.enum(ENUMS["semester_results.standing"]),
  }),
  award: z
    .object({ awardClass: z.string(), certificateNo: z.string(), awardedOn: z.iso.date() })
    .nullable(),
  legend: z.object({
    bands: z.array(
      z.object({
        minX100: z.number().int(),
        maxX100: z.number().int(),
        letter: z.string(),
        pointsX100: z.number().int(),
        pass: z.boolean(),
      }),
    ),
    classBands: z.array(
      z.object({ minCgpaX100: z.number().int(), maxCgpaX100: z.number().int(), label: z.string() }),
    ),
    minAwardCgpaX100: z.number().int(),
    repeatPolicy: z.enum(ENUMS["grading_schemes.repeat_policy"]),
  }),
});

export type TranscriptSnapshot = z.infer<typeof transcriptSnapshotSchema>;

export const transcriptSummarySchema = z.object({
  id: z.uuid(),
  kind: z.enum(ENUMS["transcripts.kind"]),
  serialNo: z.string(),
  status: z.enum(ENUMS["transcripts.status"]),
  issuedAt: z.iso.datetime(),
  asOf: z.iso.date(),
});

export const transcriptRequestSchema = z.object({
  id: z.uuid(),
  programmeEnrollmentId: z.uuid(),
  studentName: z.string(),
  matricNumber: z.string(),
  programmeName: z.string(),
  kind: z.enum(ENUMS["transcript_requests.kind"]),
  purpose: z.string().nullable(),
  recipientName: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  status: z.enum(ENUMS["transcript_requests.status"]),
  decisionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  transcript: transcriptSummarySchema.nullable(),
});

export type TranscriptRequest = z.infer<typeof transcriptRequestSchema>;

export const transcriptSchema = transcriptSummarySchema.extend({
  verificationCode: z.string(),
  snapshotSha256: z.string(),
  snapshot: transcriptSnapshotSchema,
  revokeReason: z.string().nullable(),
});

export type Transcript = z.infer<typeof transcriptSchema>;

export const requestTranscript = endpoint({
  method: "POST",
  path: "/programme-enrollments/:id/transcript-requests",
  summary:
    "Request a transcript: an unofficial one is issued at once (5 a day); an official one needs a purpose and recipient and waits for the Registrar",
  tag: "Transcripts",
  auth: "session",
  permission: "transcript:request:create",
  resource: { type: "programme-enrollment", param: "id" },
  params: idParams,
  body: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("UNOFFICIAL") }).strict(),
    z
      .object({
        kind: z.literal("OFFICIAL"),
        purpose: z.string().trim().min(1).max(500),
        recipientName: z.string().trim().min(1).max(200),
        recipientEmail: z.email().max(254),
      })
      .strict(),
  ]),
  response: transcriptRequestSchema,
  successStatus: 201,
});

export const getMyTranscripts = endpoint({
  method: "GET",
  path: "/me/transcripts",
  summary: "The caller's transcript requests and transcripts, newest first",
  tag: "Transcripts",
  auth: "session",
  response: z.object({ items: z.array(transcriptRequestSchema) }),
});

export const listTranscriptRequests = endpoint({
  method: "GET",
  path: "/transcript-requests",
  summary: "Transcript requests, newest first (official ones awaiting approval by default)",
  tag: "Transcripts",
  auth: "session",
  permission: "transcript:request:manage",
  query: z.object({ status: z.enum(ENUMS["transcript_requests.status"]).optional() }),
  response: z.object({ items: z.array(transcriptRequestSchema) }),
});

export const approveTranscriptRequest = endpoint({
  method: "POST",
  path: "/transcript-requests/:id/approve",
  summary: "Approve an official request (it can then be issued)",
  tag: "Transcripts",
  auth: "session",
  permission: "transcript:request:manage",
  params: idParams,
  response: transcriptRequestSchema,
  successStatus: 200,
});

export const rejectTranscriptRequest = endpoint({
  method: "POST",
  path: "/transcript-requests/:id/reject",
  summary: "Reject a request with a reason the student sees",
  tag: "Transcripts",
  auth: "session",
  permission: "transcript:request:manage",
  params: idParams,
  body: z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
  response: transcriptRequestSchema,
  successStatus: 200,
});

export const issueTranscript = endpoint({
  method: "POST",
  path: "/transcript-requests/:id/issue",
  summary:
    "Issue the transcript: snapshot, SHA-256, serial and verification code (official ones need approved semesters)",
  tag: "Transcripts",
  auth: "session",
  permission: "transcript:document:issue",
  idempotent: true,
  params: idParams,
  response: transcriptRequestSchema,
  successStatus: 200,
});

export const getTranscript = endpoint({
  method: "GET",
  path: "/transcripts/:id",
  summary: "An issued transcript with its snapshot (the student's own, or for the Registrar)",
  tag: "Transcripts",
  auth: "session",
  permission: "transcript:document:read",
  resource: { type: "transcript", param: "id" },
  params: idParams,
  response: transcriptSchema,
});

export const verificationSchema = z.object({
  valid: z.boolean(),
  status: z.enum(ENUMS["transcripts.status"]),
  issuedAt: z.iso.datetime(),
  institutionName: z.string(),
  programmeName: z.string(),
  studentInitials: z.string(),
  asOf: z.iso.date(),
  snapshotSha256: z.string(),
});

export type Verification = z.infer<typeof verificationSchema>;

export const verifyTranscript = endpoint({
  method: "GET",
  path: "/public/transcripts/:code",
  summary: "Check a transcript by its verification code (minimal fields only)",
  tag: "Transcripts",
  auth: "public",
  rateLimit: "verify",
  params: z.object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z2-7]{16}$/),
  }),
  response: verificationSchema,
});
