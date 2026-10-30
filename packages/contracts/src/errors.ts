/**
 * Error codes (TRD Appendix D, plus ONLINE_LINK_* from the v1 spec and the generic CONFLICT,
 * INTERNAL and DEPENDENCY_UNAVAILABLE) and the HTTP status each maps to (§5.4).
 * Warnings are returned alongside a successful response and never as an error envelope.
 */
export const ERROR_STATUS = {
  // General
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  RATE_LIMITED: 429,
  VERSION_MISMATCH: 412,
  CONFLICT: 409,
  INTERNAL: 500,
  DEPENDENCY_UNAVAILABLE: 503,
  // Idempotency and CSRF
  IDEMPOTENCY_IN_PROGRESS: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  CSRF_INVALID: 403,
  // Sign-in
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 429,
  ACCOUNT_NOT_FOUND: 404,
  GOOGLE_ACCOUNT_REQUIRED: 422,
  // Admissions
  INTAKE_CLOSED: 422,
  /** Intakes' application windows may not overlap (ADR-0005). */
  INTAKE_OVERLAP: 409,
  APPLICATION_ALREADY_OPEN: 409,
  APPLICATION_INCOMPLETE: 422,
  APPLICATION_STATE_INVALID: 409,
  OFFER_EXPIRED: 422,
  APPLICANT_UNDER_AGE: 422,
  // Academic and enrollment
  ALREADY_ENROLLED: 409,
  OFFERING_FULL: 409,
  ENROLLMENT_NOT_ACTIVE: 422,
  PRIMARY_REQUIRED: 422,
  CURRICULUM_LOCKED: 409,
  /** Another live offering of the cohort covers some of the same days (ADR-0005). */
  OFFERING_OVERLAP: 409,
  /** An offering may not start before its cohort's intake starts. */
  BEFORE_INTAKE_START: 422,
  /** A Class Meeting must fall within its offering's dates. */
  OUTSIDE_OFFERING_DATES: 422,
  // Class Meetings
  MEETING_STATE_INVALID: 409,
  MEETING_IN_PROGRESS: 409,
  JOIN_WINDOW_CLOSED: 422,
  PROVIDER_NOT_READY: 503,
  PROVIDER_UNAVAILABLE: 503,
  LECTURER_SCHEDULE_CONFLICT: 409,
  ROOM_CONFLICT: 409,
  ONLINE_LINK_NOT_SET: 422,
  ONLINE_LINK_INVALID: 400,
  // Attendance
  ROLL_CALL_CLOSED: 409,
  OVERRIDE_REASON_REQUIRED: 400,
  PARTICIPANT_ALREADY_MATCHED: 409,
  // Video
  VIDEO_NOT_AVAILABLE: 422,
  YOUTUBE_URL_INVALID: 400,
  YOUTUBE_VIDEO_PRIVATE: 422,
  YOUTUBE_VIDEO_NOT_FOUND: 422,
  YOUTUBE_CHANNEL_NOT_ALLOWED: 422,
  VIDEO_CHECK_UNAVAILABLE: 503,
  SOURCE_MISSING: 422,
  // Assessment
  WEIGHTS_NOT_100: 422,
  ATTEMPT_LIMIT_REACHED: 422,
  ATTEMPT_EXPIRED: 422,
  SUBMISSION_CLOSED: 422,
  NOT_ELIGIBLE_FOR_ONLINE_EXAM: 403,
  GRADEBOOK_LOCKED: 409,
  // Results and transcripts
  RESULT_NOT_FINALIZED: 422,
  RESULT_LOCKED: 409,
  SCHEME_LOCKED: 409,
  REQUIREMENTS_NOT_MET: 422,
  NO_AWARD: 422,
  TRANSCRIPT_NOT_ISSUABLE: 422,
  // Imports
  IMPORT_FILE_CHANGED: 409,
  IMPORT_ROW_INVALID: 422,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

export const WARNING_CODES = [
  "STUDENT_NO_GOOGLE_ACCOUNT",
  "LECTURER_NO_GOOGLE_ACCOUNT",
  "STUDENT_SCHEDULE_CLASH",
  "REFERRAL_CODE_UNKNOWN",
] as const;

export type WarningCode = (typeof WARNING_CODES)[number];

export interface FieldError {
  path: string;
  code: string;
  message: string;
}

/** A Class Meeting that a new or moved one would overlap (§9.5). */
export interface ScheduleConflict {
  meetingId: string;
  title: string;
  scheduledStart: string;
  scheduledEnd: string;
}

/** The error envelope every non-2xx API response uses (§5.4). */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    fieldErrors?: FieldError[];
    /** For `LECTURER_SCHEDULE_CONFLICT` and `ROOM_CONFLICT`: the meetings in the way. */
    conflicts?: ScheduleConflict[];
    requestId: string;
  };
}

export function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_STATUS, value);
}
