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
