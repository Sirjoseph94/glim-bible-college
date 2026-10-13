import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

/** Attendance (TRD §12): roll call in the room, with the v1 `mode` for online students. */

const idParams = z.object({ id: z.uuid() });

export const rollCallMarkSchema = z.object({
  studentId: z.uuid(),
  present: z.boolean(),
  late: z.boolean(),
  mode: z.enum(ENUMS["roll_call_marks.mode"]),
});

export type RollCallMark = z.infer<typeof rollCallMarkSchema>;

export const rollCallSchema = z.object({
  meetingId: z.uuid(),
  /** Send as `If-Match` with the next batch of marks. */
  version: z.number().int(),
  /** Whether marks can be changed now (§12.3 window), and the window itself. */
  open: z.boolean(),
  opensAt: z.iso.datetime(),
  /** Null until the meeting's attendance is finalized (then the lock follows). */
  closesAt: z.iso.datetime().nullable(),
  students: z.array(
    z.object({
      studentId: z.uuid(),
      name: z.string(),
      matricNumber: z.string(),
      studyMode: z.enum(ENUMS["programme_enrollments.study_mode"]),
      /** A short-lived link to the passport photo, if there is one. */
      photoUrl: z.string().nullable(),
      mark: rollCallMarkSchema.omit({ studentId: true }).nullable(),
    }),
  ),
});

export type RollCall = z.infer<typeof rollCallSchema>;

export const getRollCall = endpoint({
  method: "GET",
  path: "/class-meetings/:id/roll-call",
  summary: "The roll call: enrolled students (on-campus first) and their marks",
  tag: "Attendance",
  auth: "session",
  permission: "attendance:roll-call:mark",
  resource: { type: "class-meeting", param: "id" },
  params: idParams,
  response: rollCallSchema,
});

export const putRollCall = endpoint({
  method: "PUT",
  path: "/class-meetings/:id/roll-call",
  summary: "Save a batch of roll-call marks (If-Match on the roll call's version)",
  tag: "Attendance",
  auth: "session",
  permission: "attendance:roll-call:mark",
  resource: { type: "class-meeting", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z.object({ marks: z.array(rollCallMarkSchema).min(1).max(500) }).strict(),
  response: rollCallSchema,
});

const attendanceStatus = z.enum(ENUMS["attendance_records.override_status"]);

export const meetingAttendanceSchema = z.object({
  meetingId: z.uuid(),
  attendanceState: z.enum(ENUMS["class_meetings.attendance_state"]),
  finalizedAt: z.iso.datetime().nullable(),
  /** After this, only overrides change the records. */
  lockedAt: z.iso.datetime().nullable(),
  records: z.array(
    z.object({
      studentId: z.uuid(),
      name: z.string(),
      matricNumber: z.string(),
      /** The override if there is one, otherwise the computed status. */
      status: attendanceStatus,
      computedStatus: z.enum(ENUMS["attendance_records.computed_status"]),
      overrideStatus: attendanceStatus.nullable(),
      mode: z.enum(ENUMS["attendance_records.attendance_mode"]),
      late: z.boolean(),
      ratioBp: z.number().int(),
    }),
  ),
});

export type MeetingAttendance = z.infer<typeof meetingAttendanceSchema>;

export const getMeetingAttendance = endpoint({
  method: "GET",
  path: "/class-meetings/:id/attendance",
  summary: "A Class Meeting's attendance records",
  tag: "Attendance",
  auth: "session",
  permission: "attendance:record:read",
  resource: { type: "class-meeting", param: "id" },
  params: idParams,
  response: meetingAttendanceSchema,
});

export const myAttendanceSchema = z.object({
  courses: z.array(
    z.object({
      offeringId: z.uuid(),
      courseCode: z.string(),
      courseTitle: z.string(),
      summary: z.object({
        present: z.number().int(),
        partial: z.number().int(),
        absent: z.number().int(),
        excused: z.number().int(),
        late: z.number().int(),
      }),
      meetings: z.array(
        z.object({
          meetingId: z.uuid(),
          title: z.string(),
          scheduledStart: z.iso.datetime(),
          status: attendanceStatus,
          mode: z.enum(ENUMS["attendance_records.attendance_mode"]),
          late: z.boolean(),
          /** False until the meeting's attendance is finalized. */
          final: z.boolean(),
        }),
      ),
    }),
  ),
});

export type MyAttendance = z.infer<typeof myAttendanceSchema>;

export const getMyAttendance = endpoint({
  method: "GET",
  path: "/me/attendance",
  summary: "My attendance, per course",
  tag: "Attendance",
  auth: "session",
  response: myAttendanceSchema,
});

const recordParams = z.object({ id: z.uuid(), studentId: z.uuid() });

export const overrideAttendance = endpoint({
  method: "POST",
  path: "/class-meetings/:id/attendance/:studentId/override",
  summary: "Override a student's attendance (e.g. Excused), with a reason; survives recalculation",
  tag: "Attendance",
  auth: "session",
  permission: "attendance:record:override",
  resource: { type: "class-meeting", param: "id" },
  params: recordParams,
  body: z
    .object({
      status: z.enum(ENUMS["attendance_records.override_status"]),
      reason: z.string().trim().min(5).max(500),
    })
    .strict(),
  response: meetingAttendanceSchema.shape.records.element,
  successStatus: 200,
});

export const clearAttendanceOverride = endpoint({
  method: "DELETE",
  path: "/class-meetings/:id/attendance/:studentId/override",
  summary: "Clear an attendance override, going back to the computed status",
  tag: "Attendance",
  auth: "session",
  permission: "attendance:record:override",
  resource: { type: "class-meeting", param: "id" },
  params: recordParams,
  response: meetingAttendanceSchema.shape.records.element,
  successStatus: 200,
});

export const attendanceReportSchema = z.object({
  offering: z.object({ id: z.uuid(), courseCode: z.string(), courseTitle: z.string() }),
  meetings: z.array(
    z.object({
      meetingId: z.uuid(),
      title: z.string(),
      scheduledStart: z.iso.datetime(),
      attendanceState: z.enum(ENUMS["class_meetings.attendance_state"]),
      /** The ATTENDANCE policy version the records were computed under. */
      policyVersion: z.number().int().nullable(),
    }),
  ),
  students: z.array(
    z.object({
      studentId: z.uuid(),
      name: z.string(),
      matricNumber: z.string(),
      /** One per meeting, in the same order; null where there's no record. */
      cells: z.array(
        z
          .object({
            status: attendanceStatus,
            mode: z.enum(ENUMS["attendance_records.attendance_mode"]),
            late: z.boolean(),
            overridden: z.boolean(),
          })
          .nullable(),
      ),
    }),
  ),
});

export type AttendanceReport = z.infer<typeof attendanceReportSchema>;

export const getAttendanceReport = endpoint({
  method: "GET",
  path: "/reports/attendance",
  summary:
    "An offering's attendance: student × Class Meeting, with the mode per cell (JSON or CSV)",
  tag: "Attendance",
  auth: "session",
  permission: "attendance:report:read",
  resource: { type: "course-offering", param: "offeringId", in: "query" },
  query: z.object({
    offeringId: z.uuid(),
    format: z.enum(["json", "csv"]).default("json"),
  }),
  response: attendanceReportSchema,
});

/**
 * One Meet participant in a Class Meeting (TRD §12.4, §12.7; integration slice): their
 * sessions (raw evidence) and who the app thinks they are. `status` SUGGESTED is a name match
 * a person must confirm; CONFIRMED with no person means "not one of ours" (a guest).
 */
export const participantSchema = z.object({
  participantId: z.string(),
  kind: z.enum(ENUMS["provider_participant_sessions.participant_kind"]),
  displayName: z.string().nullable(),
  sessions: z.array(
    z.object({
      startedAt: z.iso.datetime(),
      endedAt: z.iso.datetime().nullable(),
    }),
  ),
  /** Time in the call, in whole seconds. */
  seconds: z.number().int(),
  match: z.object({
    userId: z.uuid().nullable(),
    name: z.string().nullable(),
    /** STUDENT: counted for attendance; LECTURER: kept as evidence, not counted. */
    role: z.enum(["STUDENT", "LECTURER"]).nullable(),
    method: z.enum(ENUMS["provider_participant_sessions.match_method"]),
    status: z.enum(ENUMS["provider_participant_sessions.match_status"]),
  }),
});

export type Participant = z.infer<typeof participantSchema>;

export const getParticipants = endpoint({
  method: "GET",
  path: "/class-meetings/:id/participants",
  summary: "Who was in the Meet call, and who the app matched them to",
  tag: "Attendance",
  auth: "session",
  permission: "attendance:participant:resolve",
  resource: { type: "class-meeting", param: "id" },
  params: z.object({ id: z.uuid() }),
  response: z.object({
    items: z.array(participantSchema),
    /** The people a participant can be matched to: the course's students and Lecturers. */
    candidates: z.array(
      z.object({
        userId: z.uuid(),
        name: z.string(),
        role: z.enum(["STUDENT", "LECTURER"]),
        matricNumber: z.string().nullable(),
      }),
    ),
  }),
});

export const matchParticipant = endpoint({
  method: "POST",
  path: "/class-meetings/:id/participants/:pid/match",
  summary:
    "Say who a Meet participant is (or that they aren't on the course); attendance is recomputed",
  tag: "Attendance",
  auth: "session",
  permission: "attendance:participant:resolve",
  resource: { type: "class-meeting", param: "id" },
  params: z.object({ id: z.uuid(), pid: z.string().min(1).max(200) }),
  body: z
    .object({
      /** A student or Lecturer of the course; null: not one of ours (e.g. a guest). */
      userId: z.uuid().nullable(),
      /** Match this Google account automatically in later Class Meetings. */
      remember: z.boolean().default(false),
    })
    .strict(),
  response: participantSchema,
  successStatus: 200,
});
