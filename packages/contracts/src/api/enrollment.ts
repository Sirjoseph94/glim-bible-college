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
