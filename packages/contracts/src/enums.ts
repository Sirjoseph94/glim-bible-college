/**
 * Enumerations mirrored by `text + CHECK` constraints in the database (TRD §6.1).
 * Each key is `<table>.<column>`; a db integration test asserts the CHECK constraints match.
 */
export const ENUMS = {
  // M01 identity and settings
  "users.status": ["INVITED", "ACTIVE", "SUSPENDED", "DEACTIVATED"],
  "users.email_status": ["OK", "BOUNCED", "COMPLAINED"],
  "identities.provider": ["google", "local"],
  "auth_tokens.purpose": ["INVITE", "PASSWORD_RESET"],
  "role_assignments.role": ["SYSTEM_ADMIN", "ADMISSIONS_OFFICER", "REGISTRAR", "ACADEMIC_ADMIN"],
  "policies.policy_type": [
    "ATTENDANCE",
    "RECORDING",
    "JOIN_WINDOW",
    "GOOGLE_MEET",
    "RETENTION",
    "GRADING_DEFAULTS",
    "NOTIFICATION",
    "ADMISSIONS",
  ],
  "policies.scope_type": ["INSTITUTION", "COURSE_OFFERING"],
  "integration_configs.provider": ["google_workspace", "video_host", "sendgrid"],
  "integration_configs.status": ["UNVERIFIED", "VERIFIED", "DEGRADED", "DISABLED"],
  // M02 academic core
  "programmes.award_type": ["CERTIFICATE", "DIPLOMA"],
  "programmes.status": ["ACTIVE", "ARCHIVED"],
  "academic_sessions.status": ["PLANNED", "ACTIVE", "CLOSED"],
  "semesters.status": ["PLANNED", "REGISTRATION", "ACTIVE", "CLOSED"],
  "intakes.status": ["PLANNED", "OPEN", "CLOSED"],
  "cohorts.status": ["ACTIVE", "CLOSED"],
  "curricula.status": ["DRAFT", "ACTIVE", "RETIRED"],
  "courses.status": ["ACTIVE", "ARCHIVED"],
  "curriculum_courses.course_type": ["COMPULSORY", "ELECTIVE"],
  "rooms.status": ["ACTIVE", "ARCHIVED"],
  "students.status": ["ACTIVE", "SUSPENDED", "GRADUATED", "WITHDRAWN"],
  "students.gender": ["MALE", "FEMALE"],
  "lecturers.kind": ["INTERNAL", "GUEST"],
  "lecturers.status": ["ACTIVE", "INACTIVE"],
  "programme_enrollments.study_mode": ["ON_CAMPUS", "ONLINE"],
  "programme_enrollments.status": ["ACTIVE", "DEFERRED", "WITHDRAWN", "COMPLETED"],
  "semester_enrollments.status": ["REGISTERED", "WITHDRAWN", "COMPLETED"],
  "course_offerings.status": ["DRAFT", "PUBLISHED", "ACTIVE", "COMPLETED", "CANCELLED"],
  "course_enrollments.selection": ["COMPULSORY", "ELECTIVE", "MANUAL"],
  "course_enrollments.enrollment_type": ["CREDIT", "AUDIT"],
  "course_enrollments.status": ["ENROLLED", "DROPPED", "WITHDRAWN", "COMPLETED"],
  "lecturer_assignments.role": ["PRIMARY", "CO_LECTURER", "ASSISTANT", "GUEST_LECTURER"],
  "lecturer_assignments.status": ["ACTIVE", "ENDED"],
  // M03 Class Meetings and attendance
  "class_meeting_series.status": ["ACTIVE", "ENDED"],
  "class_meetings.state": ["SCHEDULED", "OPEN", "LIVE", "ENDED", "CANCELLED", "NO_SHOW"],
  "class_meetings.provider_status": ["PENDING", "PROVISIONING", "READY", "ERROR"],
  "class_meetings.recording_mode": ["AUTO", "MANUAL", "OFF"],
  "class_meetings.attendance_state": ["PENDING", "PROVISIONAL", "FINAL", "REVIEW_REQUIRED"],
  "meeting_join_log.outcome": ["AUTHORIZED", "DENIED"],
  "provider_host_accounts.status": ["ACTIVE", "DISABLED", "THROTTLED"],
  "provider_subscriptions.status": ["ACTIVE", "EXPIRING", "EXPIRED", "SUSPENDED", "ERROR"],
  "conference_records.status": ["ACTIVE", "ENDED"],
  "provider_participant_sessions.participant_kind": ["SIGNED_IN", "ANONYMOUS", "PHONE"],
  "provider_participant_sessions.match_method": [
    "NONE",
    "GOOGLE_ID",
    "MEMBER_EMAIL",
    "NAME_ASSISTED",
    "MANUAL",
  ],
  "provider_participant_sessions.match_status": ["UNMATCHED", "SUGGESTED", "CONFIRMED"],
  "provider_events.provider": ["google_meet", "video_host", "sendgrid"],
  "provider_events.status": ["RECEIVED", "PROCESSED", "IGNORED", "FAILED"],
  "roll_call_marks.mode": ["IN_PERSON", "ONLINE"],
  "attendance_records.computed_status": ["PRESENT", "PARTIAL", "ABSENT"],
  "attendance_records.attendance_mode": ["IN_PERSON", "ONLINE", "NONE"],
  "attendance_records.override_status": ["PRESENT", "PARTIAL", "ABSENT", "EXCUSED"],
  // M04 video
  "recordings.status": [
    "DISCOVERED",
    "UPLOADING",
    "PROCESSING",
    "READY",
    "FAILED",
    "SOURCE_MISSING",
  ],
  "recordings.drive_cleanup_status": ["NOT_REQUESTED", "PENDING", "TRASHED", "SKIPPED", "FAILED"],
  "videos.origin": ["LINK", "RECORDING"],
  "videos.status": ["PROCESSING", "UNPUBLISHED", "PUBLISHED", "UNAVAILABLE", "FAILED", "DELETED"],
  "videos.visibility": ["ENROLLED", "STAFF_ONLY"],
  // M05 content and assessment
  "files.purpose": [
    "MATERIAL",
    "SUBMISSION",
    "PASSPORT_PHOTO",
    "TRANSCRIPT_PDF",
    "IMPORT",
    "ASSIGNMENT_ATTACHMENT",
  ],
  "files.status": ["PENDING_UPLOAD", "AVAILABLE", "DELETED"],
  "course_materials.kind": ["FILE", "LINK", "TEXT"],
  "course_materials.visibility": ["ENROLLED", "STAFF_ONLY"],
  "course_materials.status": ["DRAFT", "PUBLISHED", "ARCHIVED"],
  "assessments.kind": ["ASSIGNMENT", "QUIZ", "EXAM", "MANUAL"],
  "assessments.status": ["DRAFT", "PUBLISHED", "CLOSED"],
  "assignments.status": ["DRAFT", "PUBLISHED", "CLOSED"],
  "assignment_submissions.status": ["DRAFT", "SUBMITTED", "RETURNED"],
  "questions.qtype": ["MCQ_SINGLE", "MCQ_MULTI", "TRUE_FALSE", "SHORT_TEXT", "ESSAY"],
  "questions.status": ["ACTIVE", "ARCHIVED"],
  "quizzes.attempt_scoring": ["HIGHEST", "LAST", "AVERAGE"],
  "quizzes.show_answers": ["NEVER", "AFTER_ATTEMPT", "AFTER_CLOSE"],
  "quizzes.eligible_study_mode": ["ALL", "ONLINE"],
  "quizzes.status": ["DRAFT", "PUBLISHED", "CLOSED"],
  "quiz_attempts.status": ["IN_PROGRESS", "SUBMITTED", "GRADED", "EXPIRED"],
  "grades.source": ["MANUAL", "QUIZ", "SUBMISSION", "IMPORT"],
  "grades.status": ["DRAFT", "RELEASED", "EXCUSED"],
  // M06 platform
  "idempotency_keys.status": ["IN_PROGRESS", "COMPLETED"],
  "audit_logs.actor_type": ["USER", "SYSTEM", "JOB", "PROVIDER"],
  "audit_logs.outcome": ["SUCCESS", "DENIED", "FAILURE"],
  "notifications.email_status": [
    "NOT_REQUESTED",
    "PENDING",
    "DIGEST",
    "SENT",
    "FAILED",
    "SUPPRESSED",
  ],
  "import_jobs.kind": ["STUDENTS", "LECTURERS", "COURSE_ENROLLMENTS", "COURSE_RESULTS"],
  "import_jobs.status": ["QUEUED", "RUNNING", "COMPLETED", "FAILED"],
  // M07 results, awards and transcripts
  "grading_schemes.kind": ["NUC_5", "CUSTOM"],
  "grading_schemes.repeat_policy": ["KEEP_ALL", "REPLACE_LATEST", "BEST"],
  "course_results.source": ["GRADEBOOK", "IMPORT"],
  "course_results.result_kind": ["GRADED", "INCOMPLETE", "WITHDRAWN", "EXEMPT", "AUDIT"],
  "course_results.status": ["DRAFT", "FINALIZED", "APPROVED", "PUBLISHED"],
  "semester_results.standing": ["GOOD", "PROBATION", "WITHDRAW_REQUIRED", "UNKNOWN"],
  "semester_results.status": ["DRAFT", "APPROVED", "PUBLISHED"],
  "awards.status": ["DRAFT", "APPROVED", "CONFERRED"],
  "transcript_requests.kind": ["UNOFFICIAL", "OFFICIAL"],
  "transcript_requests.status": ["REQUESTED", "APPROVED", "REJECTED", "ISSUED", "CANCELLED"],
  "transcripts.kind": ["UNOFFICIAL", "OFFICIAL"],
  "transcripts.status": ["ISSUED", "REVOKED", "SUPERSEDED"],
  // M08 admissions
  "applications.study_mode": ["ON_CAMPUS", "ONLINE"],
  "applications.status": [
    "DRAFT",
    "SUBMITTED",
    "UNDER_REVIEW",
    "ADMITTED",
    "ACCEPTED",
    "REJECTED",
    "LAPSED",
    "WITHDRAWN",
  ],
  "applications.title": ["MR", "MRS", "PASTOR", "REV", "DR", "OTHER"],
  "applications.gender": ["MALE", "FEMALE"],
  "applications.marital_status": [
    "SINGLE",
    "MARRIED",
    "SINGLE_PARENT",
    "WIDOWED",
    "SEPARATED",
    "DIVORCED",
  ],
  /** `heard_via` is a text[] whose items are these (§10.2 section 6). */
  "applications.heard_via": [
    "FACEBOOK",
    "INSTAGRAM",
    "EMAIL",
    "SMS",
    "BILLBOARD",
    "FLYER",
    "FRIEND",
    "STUDENT",
    "ALUMNI",
    "STAFF",
    "BABIC_CONFERENCE",
    "NCGC_MEMBER",
    "OTHER",
  ],
} as const;

export type EnumKey = keyof typeof ENUMS;
export type EnumValue<K extends EnumKey> = (typeof ENUMS)[K][number];

// Named aliases for the enumerations used across modules.
export const STAFF_ROLES = ENUMS["role_assignments.role"];
export type StaffRole = EnumValue<"role_assignments.role">;

export const STUDY_MODES = ENUMS["programme_enrollments.study_mode"];
export type StudyMode = EnumValue<"programme_enrollments.study_mode">;

export const APPLICATION_STATUSES = ENUMS["applications.status"];
export type ApplicationStatus = EnumValue<"applications.status">;

export const CLASS_MEETING_STATES = ENUMS["class_meetings.state"];
export type ClassMeetingState = EnumValue<"class_meetings.state">;

export const VIDEO_STATUSES = ENUMS["videos.status"];
export type VideoStatus = EnumValue<"videos.status">;

export const ATTENDANCE_MODES = ENUMS["attendance_records.attendance_mode"];
export type AttendanceMode = EnumValue<"attendance_records.attendance_mode">;
