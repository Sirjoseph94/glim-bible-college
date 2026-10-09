/**
 * Notification kinds (TRD §15.1). Critical kinds are always emailed at once (people can't turn
 * them off); the rest are in-app, with a daily digest email, and each person can turn either off.
 * The web imports this list, so it holds plain data only.
 */
export const NOTIFICATION_KINDS = [
  { kind: "admissions.application.receipt", label: "Application received", critical: true },
  { kind: "admissions.application.admitted", label: "Admission offer", critical: true },
  { kind: "admissions.offer.reminder", label: "Offer reminder", critical: true },
  { kind: "admissions.application.lapsed", label: "Offer lapsed", critical: true },
  { kind: "admissions.application.accepted", label: "Welcome to GLIM", critical: true },
  { kind: "admissions.application.rejected", label: "Application decision", critical: true },
  { kind: "meeting.cancelled", label: "Class Meeting cancelled", critical: true },
  { kind: "meeting.rescheduled", label: "Class Meeting moved", critical: true },
  { kind: "results.semester-published", label: "Semester results published", critical: true },
  { kind: "transcript.issued", label: "Transcript issued", critical: true },
  { kind: "transcript.revoked", label: "Transcript revoked", critical: true },
  { kind: "video.unavailable", label: "Recording unavailable (staff)", critical: true },
  {
    kind: "video.youtube-delete-reminder",
    label: "Delete a recording in YouTube (staff)",
    critical: true,
  },
  { kind: "content.announcement", label: "Course announcements", critical: false },
  { kind: "assessment.grade-released", label: "Grades released", critical: false },
  { kind: "results.course-finalized", label: "Course result out", critical: false },
  { kind: "results.course-reopened", label: "Course result under review", critical: false },
  { kind: "results.award-conferred", label: "Award conferred", critical: false },
  { kind: "transcript.request-rejected", label: "Transcript request declined", critical: false },
  { kind: "enrollment.student.admitted", label: "Student record created", critical: false },
  {
    kind: "enrollment.registration.offering-missing",
    label: "Registration problems (staff)",
    critical: false,
  },
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]["kind"];

export const CRITICAL_KINDS: ReadonlySet<string> = new Set(
  NOTIFICATION_KINDS.filter((k) => k.critical).map((k) => k.kind),
);

/** Quiet hours in the recipient's own time zone: no non-critical email (§15.1). */
export const QUIET_HOURS = { from: 21, to: 6 } as const;
