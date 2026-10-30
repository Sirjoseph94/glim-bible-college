import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

/**
 * A student's programmes and their courses one after another, in their cohort's order
 * (ADR-0005).
 */
export const myRegistrationSchema = z.object({
  programmes: z.array(
    z.object({
      matricNumber: z.string(),
      programme: z.object({ code: z.string(), name: z.string() }),
      cohort: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
      studyMode: z.enum(ENUMS["programme_enrollments.study_mode"]),
      status: z.enum(ENUMS["programme_enrollments.status"]),
      courses: z.array(
        z.object({
          courseEnrollmentId: z.uuid(),
          offeringId: z.uuid(),
          courseCode: z.string(),
          title: z.string(),
          credits: z.string(),
          startsOn: z.iso.date(),
          endsOn: z.iso.date(),
          examOn: z.iso.date(),
          /** Set when the Lecturer gave the student a makeup exam. */
          makeupOn: z.iso.date().nullable(),
          offeringStatus: z.enum(ENUMS["course_offerings.status"]),
          selection: z.enum(ENUMS["course_enrollments.selection"]),
          status: z.enum(ENUMS["course_enrollments.status"]),
        }),
      ),
    }),
  ),
});

export type MyRegistration = z.infer<typeof myRegistrationSchema>;

export const getMyRegistration = endpoint({
  method: "GET",
  path: "/me/registration",
  summary: "The signed-in student's programmes and registered courses, in date order",
  tag: "Enrollment",
  auth: "session",
  response: myRegistrationSchema,
});

const idParams = z.object({ id: z.uuid() });
const enrollmentStatus = z.enum(ENUMS["course_enrollments.status"]);
const selection = z.enum(ENUMS["course_enrollments.selection"]);

export const rosterItemSchema = z.object({
  courseEnrollmentId: z.uuid(),
  studentName: z.string(),
  matricNumber: z.string(),
  programmeCode: z.string(),
  cohortCode: z.string(),
  selection,
  status: enrollmentStatus,
  enrolledAt: z.iso.datetime(),
});

export type RosterItem = z.infer<typeof rosterItemSchema>;

export const getRoster = endpoint({
  method: "GET",
  path: "/course-offerings/:id/enrollments",
  summary: "The students registered for a Course Offering",
  tag: "Enrollment",
  auth: "session",
  permission: "enrollment:course-enrollment:read",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  response: z.object({ items: z.array(rosterItemSchema) }),
});

export const registerManually = endpoint({
  method: "POST",
  path: "/course-offerings/:id/enrollments",
  summary:
    "Register a student by Matric Number (a retake, a missed course or a transfer), with a reason",
  tag: "Enrollment",
  auth: "session",
  permission: "enrollment:course-enrollment:manage",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  body: z
    .object({
      matricNumber: z.string().trim().min(1).max(40),
      reason: z.string().trim().min(3).max(500),
    })
    .strict(),
  response: rosterItemSchema,
  successStatus: 201,
});

export const withdrawCourseEnrollment = endpoint({
  method: "POST",
  path: "/course-enrollments/:id/withdraw",
  summary: "Withdraw a student from a course, with a reason",
  tag: "Enrollment",
  auth: "session",
  permission: "enrollment:course-enrollment:manage",
  resource: { type: "course-enrollment", param: "id" },
  params: idParams,
  body: z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
  response: rosterItemSchema,
  successStatus: 200,
});
