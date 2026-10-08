import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

/** A student's programmes and what they're registered for, semester by semester (TRD §9.3). */
export const myRegistrationSchema = z.object({
  programmes: z.array(
    z.object({
      matricNumber: z.string(),
      programme: z.object({ code: z.string(), name: z.string() }),
      studyMode: z.enum(ENUMS["programme_enrollments.study_mode"]),
      currentLevel: z.number().int(),
      status: z.enum(ENUMS["programme_enrollments.status"]),
      semesters: z.array(
        z.object({
          semesterEnrollmentId: z.uuid(),
          semester: z.object({
            id: z.uuid(),
            name: z.string(),
            sessionName: z.string(),
            status: z.enum(ENUMS["semesters.status"]),
            startsOn: z.iso.date(),
            endsOn: z.iso.date(),
          }),
          levelNo: z.number().int(),
          courses: z.array(
            z.object({
              courseEnrollmentId: z.uuid(),
              offeringId: z.uuid(),
              courseCode: z.string(),
              title: z.string(),
              credits: z.string(),
              selection: z.enum(ENUMS["course_enrollments.selection"]),
              status: z.enum(ENUMS["course_enrollments.status"]),
            }),
          ),
        }),
      ),
    }),
  ),
});

export type MyRegistration = z.infer<typeof myRegistrationSchema>;

export const getMyRegistration = endpoint({
  method: "GET",
  path: "/me/registration",
  summary: "The signed-in student's programmes and registered courses, newest semester first",
  tag: "Enrollment",
  auth: "session",
  response: myRegistrationSchema,
});

const idParams = z.object({ id: z.uuid() });
const enrollmentStatus = z.enum(ENUMS["course_enrollments.status"]);
const selection = z.enum(ENUMS["course_enrollments.selection"]);

/** One semester's registration: what's registered, and the electives the student may choose. */
export const semesterRegistrationSchema = z.object({
  semesterEnrollmentId: z.uuid(),
  levelNo: z.number().int(),
  semester: z.object({
    id: z.uuid(),
    name: z.string(),
    sessionName: z.string(),
    status: z.enum(ENUMS["semesters.status"]),
    addDropDeadlineOn: z.iso.date().nullable(),
  }),
  /** Electives can be added or dropped now: registration or teaching, before the deadline. */
  windowOpen: z.boolean(),
  courses: z.array(
    z.object({
      courseEnrollmentId: z.uuid(),
      offeringId: z.uuid(),
      courseCode: z.string(),
      title: z.string(),
      credits: z.string(),
      selection,
      status: enrollmentStatus,
    }),
  ),
  electives: z.array(
    z.object({
      offeringId: z.uuid(),
      courseCode: z.string(),
      title: z.string(),
      credits: z.string(),
      capacity: z.number().int().nullable(),
      enrolled: z.number().int(),
      full: z.boolean(),
      /** Set when the student is registered for it (ENROLLED). */
      courseEnrollmentId: z.uuid().nullable(),
    }),
  ),
});

export type SemesterRegistration = z.infer<typeof semesterRegistrationSchema>;

const semesterEnrollmentResource = { type: "semester-enrollment", param: "id" } as const;

export const getSemesterRegistration = endpoint({
  method: "GET",
  path: "/semester-enrollments/:id/registration",
  summary: "A semester's registration: registered courses and available electives",
  tag: "Enrollment",
  auth: "session",
  permission: "enrollment:course-enrollment:read",
  resource: semesterEnrollmentResource,
  params: idParams,
  response: semesterRegistrationSchema,
});

export const addElective = endpoint({
  method: "POST",
  path: "/semester-enrollments/:id/electives",
  summary: "Add an elective for your Level and semester, before the add/drop deadline",
  tag: "Enrollment",
  auth: "session",
  permission: "enrollment:elective:select",
  resource: semesterEnrollmentResource,
  params: idParams,
  body: z.object({ offeringId: z.uuid() }).strict(),
  response: semesterRegistrationSchema,
  successStatus: 200,
});

export const dropElective = endpoint({
  method: "DELETE",
  path: "/semester-enrollments/:id/electives/:courseEnrollmentId",
  summary: "Drop an elective, before the add/drop deadline",
  tag: "Enrollment",
  auth: "session",
  permission: "enrollment:elective:select",
  resource: semesterEnrollmentResource,
  params: z.object({ id: z.uuid(), courseEnrollmentId: z.uuid() }),
  response: semesterRegistrationSchema,
  successStatus: 200,
});

export const rosterItemSchema = z.object({
  courseEnrollmentId: z.uuid(),
  studentName: z.string(),
  matricNumber: z.string(),
  programmeCode: z.string(),
  levelNo: z.number().int(),
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
  summary: "Register a student by Matric Number (e.g. a retake), with a reason",
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
  summary:
    "Withdraw a student from a course (after the deadline, or a compulsory course), with a reason",
  tag: "Enrollment",
  auth: "session",
  permission: "enrollment:course-enrollment:manage",
  resource: { type: "course-enrollment", param: "id" },
  params: idParams,
  body: z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
  response: rosterItemSchema,
  successStatus: 200,
});
