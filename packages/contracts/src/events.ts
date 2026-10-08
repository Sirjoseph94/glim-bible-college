/**
 * Domain events (TRD §17.3). Each is enqueued on the `domain-event` queue in the same transaction
 * as the change that raised it, and fanned out to idempotent subscribers by the worker.
 */
export const DOMAIN_EVENTS = [
  // Admissions
  "admissions.application.submitted",
  "admissions.application.admitted",
  "admissions.application.rejected",
  "admissions.application.lapsed",
  "admissions.application.withdrawn",
  "admissions.application.accepted",
  // Academic
  "academic.session.activated",
  "academic.semester.registration-opened",
  "academic.semester.closed",
  // Offerings
  "course.offering.created",
  "course.offering.published",
  "course.offering.cancelled",
  // Enrollment
  "course.enrollment.activated",
  "course.enrollment.ended",
  // Lecturing
  "lecturing.assignment.created",
  "lecturing.assignment.ended",
  // Class Meetings
  "meeting.scheduled",
  "meeting.provisioned",
  "meeting.started",
  "meeting.ended",
  "meeting.cancelled",
  "meeting.rescheduled",
  // Attendance
  "attendance.roll-call.updated",
  "attendance.finalized",
  "attendance.record.overridden",
  // Recordings and video
  "recording.discovered",
  "video.added",
  "video.published",
  "video.unpublished",
  "video.unavailable",
  "video.deleted",
  // Assessment
  "assessment.grade.released",
  // Results
  "results.course.finalized",
  "results.course.reopened",
  "results.semester.approved",
  "results.semester.published",
  "results.award.conferred",
  // Transcripts
  "transcript.issued",
  "transcript.revoked",
  "transcript.superseded",
] as const;

export type DomainEventName = (typeof DOMAIN_EVENTS)[number];

/** The payload of a job on the `domain-event` queue. */
export interface DomainEvent<P = Record<string, unknown>> {
  id: string;
  name: DomainEventName;
  occurredAt: string;
  actorUserId: string | null;
  payload: P;
}
