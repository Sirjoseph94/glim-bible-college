import { date, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { citext, enumCheck, std, stdRo, tstz } from "./columns";
import { files } from "./content";
import { programmeEnrollments, students } from "./enrollment";
import { users } from "./identity";

/** Owner: transcripts. Gap-free transcript serial numbers per year. */
export const transcriptSequences = pgTable("transcript_sequences", {
  year: integer().primaryKey(),
  nextValue: integer("next_value").notNull().default(1),
});

/**
 * Owner: transcripts (TRD §6.8, §14.7). A student's request for a transcript: unofficial ones
 * are issued at once; official ones (with a purpose and recipient) wait for the Registrar.
 */
export const transcriptRequests = pgTable(
  "transcript_requests",
  {
    ...std(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    programmeEnrollmentId: uuid("programme_enrollment_id")
      .notNull()
      .references(() => programmeEnrollments.id, { onDelete: "restrict" }),
    kind: text().notNull(),
    purpose: text(),
    recipientName: text("recipient_name"),
    recipientEmail: citext("recipient_email"),
    status: text().notNull().default("REQUESTED"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: tstz("decided_at"),
    decisionReason: text("decision_reason"),
  },
  (t) => [
    enumCheck("transcript_requests.kind", t.kind),
    enumCheck("transcript_requests.status", t.status),
    index("transcript_requests_student").on(t.studentId, t.createdAt),
    index("transcript_requests_status").on(t.status, t.createdAt),
  ],
);

/**
 * Owner: transcripts. An issued transcript: an immutable snapshot whose SHA-256 anchors its
 * integrity. Only its status (and revocation details, and the rendered PDF) may change; a trigger
 * refuses anything else.
 */
export const transcripts = pgTable(
  "transcripts",
  {
    ...stdRo(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    programmeEnrollmentId: uuid("programme_enrollment_id")
      .notNull()
      .references(() => programmeEnrollments.id, { onDelete: "restrict" }),
    requestId: uuid("request_id").references(() => transcriptRequests.id, {
      onDelete: "restrict",
    }),
    kind: text().notNull(),
    serialNo: text("serial_no").notNull().unique(),
    verificationCode: text("verification_code").notNull().unique(),
    asOf: date("as_of").notNull(),
    issuedBy: uuid("issued_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    issuedAt: tstz("issued_at").notNull().defaultNow(),
    snapshot: jsonb().notNull(),
    snapshotSha256: text("snapshot_sha256").notNull(),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "restrict" }),
    status: text().notNull().default("ISSUED"),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
    revokedAt: tstz("revoked_at"),
    revokeReason: text("revoke_reason"),
  },
  (t) => [
    enumCheck("transcripts.kind", t.kind),
    enumCheck("transcripts.status", t.status),
    index("transcripts_student").on(t.studentId, t.issuedAt),
  ],
);
