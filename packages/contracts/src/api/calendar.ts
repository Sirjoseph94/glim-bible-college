import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

const idParams = z.object({ id: z.uuid() });
const isoDate = z.iso.date();
const optionalDate = isoDate.nullable().optional();
const code = z.string().trim().min(1).max(20);

// ---- Academic Sessions ----

export const academicSessionSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  startsOn: isoDate,
  endsOn: isoDate,
  status: z.enum(ENUMS["academic_sessions.status"]),
  version: z.number().int(),
});

export type AcademicSession = z.infer<typeof academicSessionSchema>;

export const listAcademicSessions = endpoint({
  method: "GET",
  path: "/academic-sessions",
  summary: "Academic Sessions, newest first",
  tag: "Calendar",
  auth: "session",
  permission: "academic:structure:read",
  response: z.object({ items: z.array(academicSessionSchema) }),
});

export const createAcademicSession = endpoint({
  method: "POST",
  path: "/academic-sessions",
  summary: "Plan an Academic Session (e.g. 2027/2028, September to June)",
  tag: "Calendar",
  auth: "session",
  permission: "academic:structure:manage",
  body: z
    .object({
      code: z
        .string()
        .trim()
        .regex(/^\d{4}\/\d{4}$/, "Use the form 2027/2028"),
      name: z.string().trim().min(1).max(100),
      startsOn: isoDate,
      endsOn: isoDate,
    })
    .strict(),
  response: academicSessionSchema,
});

export const updateAcademicSession = endpoint({
  method: "PATCH",
  path: "/academic-sessions/:id",
  summary: "Correct a planned session's name or dates",
  tag: "Calendar",
  auth: "session",
  permission: "academic:structure:manage",
  resource: { type: "academic-session", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      startsOn: isoDate.optional(),
      endsOn: isoDate.optional(),
    })
    .strict(),
  response: academicSessionSchema,
});

const sessionTransition = (action: "activate" | "close", summary: string) =>
  endpoint({
    method: "POST",
    path: `/academic-sessions/:id/${action}`,
    summary,
    tag: "Calendar",
    auth: "session",
    permission: "academic:structure:manage",
    resource: { type: "academic-session", param: "id" },
    params: idParams,
    response: academicSessionSchema,
    successStatus: 200,
  });

export const activateAcademicSession = sessionTransition(
  "activate",
  "Start the session (only one may be active); triggers Year 1 → Year 2 progression",
);
export const closeAcademicSession = sessionTransition(
  "close",
  "Close the session once all its semesters are closed",
);

// ---- Semesters ----

export const semesterSchema = z.object({
  id: z.uuid(),
  academicSessionId: z.uuid(),
  code: z.string(),
  name: z.string(),
  sequence: z.number().int(),
  startsOn: isoDate,
  endsOn: isoDate,
  registrationOpensOn: isoDate.nullable(),
  registrationClosesOn: isoDate.nullable(),
  addDropDeadlineOn: isoDate.nullable(),
  examsStartOn: isoDate.nullable(),
  examsEndOn: isoDate.nullable(),
  status: z.enum(ENUMS["semesters.status"]),
  version: z.number().int(),
});

export type Semester = z.infer<typeof semesterSchema>;

const semesterDates = {
  startsOn: isoDate,
  endsOn: isoDate,
  registrationOpensOn: optionalDate,
  registrationClosesOn: optionalDate,
  addDropDeadlineOn: optionalDate,
  examsStartOn: optionalDate,
  examsEndOn: optionalDate,
};

export const listSemesters = endpoint({
  method: "GET",
  path: "/semesters",
  summary: "Semesters, optionally of one Academic Session",
  tag: "Calendar",
  auth: "session",
  permission: "academic:structure:read",
  query: z.object({ sessionId: z.uuid().optional() }),
  response: z.object({ items: z.array(semesterSchema) }),
});

export const createSemester = endpoint({
  method: "POST",
  path: "/semesters",
  summary: "Add a semester to an Academic Session",
  tag: "Calendar",
  auth: "session",
  permission: "academic:structure:manage",
  body: z
    .object({
      academicSessionId: z.uuid(),
      code,
      name: z.string().trim().min(1).max(100),
      sequence: z.union([z.literal(1), z.literal(2)]),
      ...semesterDates,
    })
    .strict(),
  response: semesterSchema,
});

export const updateSemester = endpoint({
  method: "PATCH",
  path: "/semesters/:id",
  summary: "Change a semester's name or dates (not once it's closed)",
  tag: "Calendar",
  auth: "session",
  permission: "academic:structure:manage",
  resource: { type: "semester", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      startsOn: isoDate.optional(),
      endsOn: isoDate.optional(),
      registrationOpensOn: optionalDate,
      registrationClosesOn: optionalDate,
      addDropDeadlineOn: optionalDate,
      examsStartOn: optionalDate,
      examsEndOn: optionalDate,
    })
    .strict(),
  response: semesterSchema,
});

const semesterTransition = (action: "open-registration" | "activate" | "close", summary: string) =>
  endpoint({
    method: "POST",
    path: `/semesters/:id/${action}`,
    summary,
    tag: "Calendar",
    auth: "session",
    permission: "academic:structure:manage",
    resource: { type: "semester", param: "id" },
    params: idParams,
    response: semesterSchema,
    successStatus: 200,
  });

export const openSemesterRegistration = semesterTransition(
  "open-registration",
  "Open registration: compulsory courses are registered for every active student",
);
export const activateSemester = semesterTransition("activate", "Start teaching for the semester");
export const closeSemester = semesterTransition(
  "close",
  "Close the semester: offerings and enrollments complete, results are computed",
);

// ---- Rooms ----

export const roomSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  capacity: z.number().int().nullable(),
  status: z.enum(ENUMS["rooms.status"]),
  version: z.number().int(),
});

export type Room = z.infer<typeof roomSchema>;

export const listRooms = endpoint({
  method: "GET",
  path: "/rooms",
  summary: "Rooms",
  tag: "Calendar",
  auth: "session",
  permission: "academic:structure:read",
  response: z.object({ items: z.array(roomSchema) }),
});

export const createRoom = endpoint({
  method: "POST",
  path: "/rooms",
  summary: "Add a Room",
  tag: "Calendar",
  auth: "session",
  permission: "academic:structure:manage",
  body: z
    .object({
      code,
      name: z.string().trim().min(1).max(100),
      capacity: z.number().int().positive().max(10_000).nullable().default(null),
    })
    .strict(),
  response: roomSchema,
});

export const updateRoom = endpoint({
  method: "PATCH",
  path: "/rooms/:id",
  summary: "Rename, resize or archive a Room",
  tag: "Calendar",
  auth: "session",
  permission: "academic:structure:manage",
  resource: { type: "room", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      capacity: z.number().int().positive().max(10_000).nullable().optional(),
      status: z.enum(ENUMS["rooms.status"]).optional(),
    })
    .strict(),
  response: roomSchema,
});
