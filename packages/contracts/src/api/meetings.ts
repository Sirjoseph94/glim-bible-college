import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

/**
 * Class Meetings (TRD §9.5, §11; v1 spec: a pasted online link instead of a provisioned Meet
 * space). A Class Meeting happens in an optional Room and online at once.
 */

const idParams = z.object({ id: z.uuid() });

/** v1: the Lecturer pastes a Google Meet link; anything else is `ONLINE_LINK_INVALID`. */
export const MEET_LINK_PATTERN = /^https:\/\/meet\.google\.com\/[A-Za-z0-9-]+(\?[^\s]*)?$/;

const onlineLink = z.string().trim().max(300).nullable();

export const classMeetingSchema = z.object({
  id: z.uuid(),
  courseOfferingId: z.uuid(),
  courseCode: z.string(),
  courseTitle: z.string(),
  seriesId: z.uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  scheduledStart: z.iso.datetime({ offset: true }),
  scheduledEnd: z.iso.datetime({ offset: true }),
  timezone: z.string(),
  room: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
  /** Whether an online link is set. Students get the link itself from `/join`, near class time. */
  hasOnlineLink: z.boolean(),
  /** The link, for people who manage the meeting; null for everyone else. */
  onlineLink: z.string().nullable(),
  state: z.enum(ENUMS["class_meetings.state"]),
  recordingMode: z.enum(ENUMS["class_meetings.recording_mode"]),
  version: z.number().int(),
});

export type ClassMeeting = z.infer<typeof classMeetingSchema>;

export const scheduleWarningSchema = z.object({
  code: z.literal("STUDENT_SCHEDULE_CLASH"),
  /** How many of the offering's enrolled students have another Class Meeting at that time. */
  count: z.number().int(),
  sampleMeetingIds: z.array(z.uuid()),
});

export type ScheduleWarning = z.infer<typeof scheduleWarningSchema>;

export const createClassMeeting = endpoint({
  method: "POST",
  path: "/course-offerings/:id/class-meetings",
  summary: "Schedule a Class Meeting, with an optional Room and online link",
  tag: "Class Meetings",
  auth: "session",
  permission: "meeting:class-meeting:manage",
  resource: { type: "course-offering", param: "id" },
  idempotent: true,
  params: idParams,
  body: z
    .object({
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(2000).nullable().optional(),
      scheduledStart: z.iso.datetime({ offset: true }),
      scheduledEnd: z.iso.datetime({ offset: true }),
      roomId: z.uuid().nullable().optional(),
      onlineLink: onlineLink.optional(),
      recordingMode: z.enum(ENUMS["class_meetings.recording_mode"]).optional(),
      /** Academic Admin only: book the Lecturers even though they're busy, with a reason. */
      overrideConflicts: z.boolean().optional(),
      reason: z.string().trim().min(3).max(500).optional(),
    })
    .strict(),
  response: z.object({ meeting: classMeetingSchema, warnings: z.array(scheduleWarningSchema) }),
  successStatus: 201,
});

export const listClassMeetings = endpoint({
  method: "GET",
  path: "/course-offerings/:id/class-meetings",
  summary: "An offering's Class Meetings, earliest first",
  tag: "Class Meetings",
  auth: "session",
  permission: "meeting:class-meeting:read",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  response: z.object({ items: z.array(classMeetingSchema) }),
});

export const getClassMeeting = endpoint({
  method: "GET",
  path: "/class-meetings/:id",
  summary: "A Class Meeting",
  tag: "Class Meetings",
  auth: "session",
  permission: "meeting:class-meeting:read",
  resource: { type: "class-meeting", param: "id" },
  params: idParams,
  response: classMeetingSchema,
});

/** Which occurrences of a series a change applies to (§11.9). */
const scope = z.enum(["THIS_ONLY", "ALL_FUTURE"]);

export const updateClassMeeting = endpoint({
  method: "PATCH",
  path: "/class-meetings/:id",
  summary:
    "Change or reschedule a Class Meeting (or it and the series' later ones); enrolled students are told of a new time or Room",
  tag: "Class Meetings",
  auth: "session",
  permission: "meeting:class-meeting:manage",
  resource: { type: "class-meeting", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().trim().max(2000).nullable().optional(),
      scheduledStart: z.iso.datetime({ offset: true }).optional(),
      scheduledEnd: z.iso.datetime({ offset: true }).optional(),
      roomId: z.uuid().nullable().optional(),
      onlineLink: onlineLink.optional(),
      recordingMode: z.enum(ENUMS["class_meetings.recording_mode"]).optional(),
      /** For a series occurrence; THIS_ONLY when omitted. */
      scope: scope.optional(),
      overrideConflicts: z.boolean().optional(),
      reason: z.string().trim().min(3).max(500).optional(),
    })
    .strict(),
  response: z.object({
    meeting: classMeetingSchema,
    warnings: z.array(scheduleWarningSchema),
    /** How many Class Meetings changed (more than one for ALL_FUTURE). */
    changed: z.number().int(),
  }),
});

export const cancelClassMeeting = endpoint({
  method: "POST",
  path: "/class-meetings/:id/cancel",
  summary:
    "Cancel a Class Meeting (or it and the series' later ones), with a reason; enrolled students are told",
  tag: "Class Meetings",
  auth: "session",
  permission: "meeting:class-meeting:manage",
  resource: { type: "class-meeting", param: "id" },
  params: idParams,
  body: z.object({ reason: z.string().trim().min(3).max(500), scope: scope.optional() }).strict(),
  response: z.object({ meeting: classMeetingSchema, cancelled: z.number().int() }),
  successStatus: 200,
});

export const seriesSchema = z.object({
  id: z.uuid(),
  courseOfferingId: z.uuid(),
  titleTemplate: z.string(),
  rrule: z.string(),
  timezone: z.string(),
  startsOn: z.iso.date(),
  untilOn: z.iso.date().nullable(),
  startTime: z.string(),
  durationMinutes: z.number().int(),
  roomId: z.uuid().nullable(),
  generatedThrough: z.iso.date().nullable(),
  status: z.enum(ENUMS["class_meeting_series.status"]),
});

export type ClassMeetingSeries = z.infer<typeof seriesSchema>;

export const createClassMeetingSeries = endpoint({
  method: "POST",
  path: "/course-offerings/:id/class-meeting-series",
  summary:
    "Schedule a weekly series of Class Meetings; any clash rejects the whole series and lists the dates",
  tag: "Class Meetings",
  auth: "session",
  permission: "meeting:class-meeting:manage",
  resource: { type: "course-offering", param: "id" },
  idempotent: true,
  params: idParams,
  body: z
    .object({
      /** `{n}` becomes the occurrence number, e.g. "Week {n}". */
      titleTemplate: z.string().trim().min(1).max(200),
      weekdays: z
        .array(z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]))
        .min(1)
        .max(7),
      interval: z.number().int().min(1).max(4).optional(),
      startsOn: z.iso.date(),
      untilOn: z.iso.date().nullable().optional(),
      /** Wall-clock time in the institution's timezone. */
      startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      durationMinutes: z.number().int().min(5).max(600),
      roomId: z.uuid().nullable().optional(),
      /** Copied to every occurrence. */
      onlineLink: onlineLink.optional(),
      overrideConflicts: z.boolean().optional(),
      reason: z.string().trim().min(3).max(500).optional(),
    })
    .strict(),
  response: z.object({
    series: seriesSchema,
    meetings: z.array(classMeetingSchema),
    warnings: z.array(scheduleWarningSchema),
  }),
  successStatus: 201,
});

export const getMySchedule = endpoint({
  method: "GET",
  path: "/me/schedule",
  summary:
    "My Class Meetings between two instants: as a student (enrolled courses) and as a Lecturer",
  tag: "Class Meetings",
  auth: "session",
  query: z.object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  }),
  response: z.object({
    items: z.array(
      classMeetingSchema.extend({
        /** Why it's on my schedule. */
        as: z.enum(["STUDENT", "LECTURER"]),
      }),
    ),
  }),
});
