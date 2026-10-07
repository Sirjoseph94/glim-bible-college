import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

const idParams = z.object({ id: z.uuid() });
const lecturerRole = z.enum(ENUMS["lecturer_assignments.role"]);

// ---- Lecturers ----

export const lecturerSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  email: z.string(),
  title: z.string().nullable(),
  givenName: z.string(),
  familyName: z.string(),
  displayName: z.string(),
  staffCode: z.string().nullable(),
  kind: z.enum(ENUMS["lecturers.kind"]),
  status: z.enum(ENUMS["lecturers.status"]),
  version: z.number().int(),
});

export type Lecturer = z.infer<typeof lecturerSchema>;

export const listLecturers = endpoint({
  method: "GET",
  path: "/lecturers",
  summary: "Lecturers",
  tag: "Lecturing",
  auth: "session",
  permission: "lecturing:assignment:read",
  response: z.object({ items: z.array(lecturerSchema) }),
});

export const createLecturer = endpoint({
  method: "POST",
  path: "/lecturers",
  summary: "Make someone a Lecturer: links an existing account by email, or invites a new one",
  tag: "Lecturing",
  auth: "session",
  permission: "lecturing:assignment:manage",
  body: z
    .object({
      email: z.email().max(254),
      title: z.string().trim().max(40).nullable().default(null),
      givenName: z.string().trim().min(1).max(100),
      familyName: z.string().trim().min(1).max(100),
      kind: z.enum(ENUMS["lecturers.kind"]).default("INTERNAL"),
      staffCode: z.string().trim().min(1).max(40).nullable().default(null),
    })
    .strict(),
  response: z.object({ lecturer: lecturerSchema, invited: z.boolean() }),
});

export const updateLecturer = endpoint({
  method: "PATCH",
  path: "/lecturers/:id",
  summary: "Edit a Lecturer's profile or make them inactive",
  tag: "Lecturing",
  auth: "session",
  permission: "lecturing:assignment:manage",
  resource: { type: "lecturer", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      title: z.string().trim().max(40).nullable().optional(),
      givenName: z.string().trim().min(1).max(100).optional(),
      familyName: z.string().trim().min(1).max(100).optional(),
      staffCode: z.string().trim().min(1).max(40).nullable().optional(),
      kind: z.enum(ENUMS["lecturers.kind"]).optional(),
      status: z.enum(ENUMS["lecturers.status"]).optional(),
    })
    .strict(),
  response: lecturerSchema,
});

// ---- Course Offerings ----

export const assignmentSchema = z.object({
  id: z.uuid(),
  lecturerId: z.uuid(),
  lecturerName: z.string(),
  role: lecturerRole,
  status: z.enum(ENUMS["lecturer_assignments.status"]),
});

export const offeringSchema = z.object({
  id: z.uuid(),
  courseId: z.uuid(),
  courseCode: z.string(),
  /** The offering's title override, or the course title. */
  title: z.string(),
  credits: z.string(),
  semesterId: z.uuid(),
  semesterName: z.string(),
  sessionCode: z.string(),
  sectionCode: z.string(),
  capacity: z.number().int().nullable(),
  status: z.enum(ENUMS["course_offerings.status"]),
  version: z.number().int(),
  lecturers: z.array(assignmentSchema),
});

export type Offering = z.infer<typeof offeringSchema>;

export const listOfferings = endpoint({
  method: "GET",
  path: "/course-offerings",
  summary:
    "Course Offerings the caller may see: all of them for academic staff, their own for Lecturers",
  tag: "Offerings",
  auth: "session",
  query: z.object({
    semesterId: z.uuid().optional(),
    status: z.enum(ENUMS["course_offerings.status"]).optional(),
  }),
  response: z.object({ items: z.array(offeringSchema) }),
});

export const createOffering = endpoint({
  method: "POST",
  path: "/course-offerings",
  summary: "Offer a course in a semester, optionally with its Lecturers",
  tag: "Offerings",
  auth: "session",
  permission: "academic:course-offering:manage",
  body: z
    .object({
      courseId: z.uuid(),
      semesterId: z.uuid(),
      sectionCode: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9]{1,8}$/)
        .default("01"),
      titleOverride: z.string().trim().min(1).max(200).nullable().default(null),
      capacity: z.number().int().positive().max(10_000).nullable().default(null),
      lecturers: z
        .array(z.object({ lecturerId: z.uuid(), role: lecturerRole }).strict())
        .max(10)
        .default([]),
    })
    .strict(),
  response: offeringSchema,
});

export const getOffering = endpoint({
  method: "GET",
  path: "/course-offerings/:id",
  summary: "A Course Offering with its Lecturers",
  tag: "Offerings",
  auth: "session",
  permission: "academic:course-offering:read",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  response: offeringSchema,
});

export const updateOffering = endpoint({
  method: "PATCH",
  path: "/course-offerings/:id",
  summary: "Change an offering's title or capacity",
  tag: "Offerings",
  auth: "session",
  permission: "academic:course-offering:manage",
  resource: { type: "course-offering", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      titleOverride: z.string().trim().min(1).max(200).nullable().optional(),
      capacity: z.number().int().positive().max(10_000).nullable().optional(),
    })
    .strict(),
  response: offeringSchema,
});

export const publishOffering = endpoint({
  method: "POST",
  path: "/course-offerings/:id/publish",
  summary: "Publish a draft offering; it needs an active Primary Lecturer",
  tag: "Offerings",
  auth: "session",
  permission: "academic:course-offering:manage",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  response: offeringSchema,
  successStatus: 200,
});

export const cancelOffering = endpoint({
  method: "POST",
  path: "/course-offerings/:id/cancel",
  summary: "Cancel an offering",
  tag: "Offerings",
  auth: "session",
  permission: "academic:course-offering:manage",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  body: z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
  response: offeringSchema,
  successStatus: 200,
});

// ---- Lecturer assignments ----

export const listOfferingLecturers = endpoint({
  method: "GET",
  path: "/course-offerings/:id/lecturers",
  summary: "Who teaches an offering (active and ended assignments)",
  tag: "Lecturing",
  auth: "session",
  permission: "lecturing:assignment:read",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  response: z.object({ items: z.array(assignmentSchema) }),
});

export const assignLecturer = endpoint({
  method: "POST",
  path: "/course-offerings/:id/lecturers",
  summary: "Assign a Lecturer; assigning a new Primary replaces the current one",
  tag: "Lecturing",
  auth: "session",
  permission: "lecturing:assignment:manage",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  body: z.object({ lecturerId: z.uuid(), role: lecturerRole }).strict(),
  response: offeringSchema,
});

export const endAssignment = endpoint({
  method: "DELETE",
  path: "/course-offerings/:id/lecturers/:assignmentId",
  summary: "End a Lecturer's assignment to an offering",
  tag: "Lecturing",
  auth: "session",
  permission: "lecturing:assignment:manage",
  resource: { type: "course-offering", param: "id" },
  params: z.object({ id: z.uuid(), assignmentId: z.uuid() }),
  response: z.object({}),
  successStatus: 204,
});
