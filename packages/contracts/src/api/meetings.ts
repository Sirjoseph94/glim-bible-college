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

export const updateClassMeeting = endpoint({
  method: "PATCH",
  path: "/class-meetings/:id",
  summary: "Change a Class Meeting's title, description, online link or recording mode",
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
      onlineLink: onlineLink.optional(),
      recordingMode: z.enum(ENUMS["class_meetings.recording_mode"]).optional(),
    })
    .strict(),
  response: classMeetingSchema,
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
