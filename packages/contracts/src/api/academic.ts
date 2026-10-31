import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";
import { page, pageQuery } from "../pagination";

/** Credits are exact one-decimal values carried as strings, e.g. "3.0" (INV-14, numeric(4,1)). */
export const credits = z
  .string()
  .regex(/^\d{1,3}(\.\d)?$/, "Use a number with at most one decimal place, e.g. 3 or 2.5")
  .transform((v) => (v.includes(".") ? v : `${v}.0`));

const code = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 _/-]*$/, "Letters, digits, spaces, _ / -");
const idParams = z.object({ id: z.uuid() });

// ---- Programmes ----

export const programmeSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  status: z.enum(ENUMS["programmes.status"]),
  /** The grading scheme its results use (§14.4), set by the Registrar. */
  gradingSchemeId: z.uuid().nullable(),
  version: z.number().int(),
});

export type Programme = z.infer<typeof programmeSchema>;

const programmeFields = {
  code,
  name: z.string().trim().min(1).max(200),
};

export const listProgrammes = endpoint({
  method: "GET",
  path: "/programmes",
  summary: "All programmes",
  tag: "Academic",
  auth: "session",
  permission: "academic:structure:read",
  response: z.object({ items: z.array(programmeSchema) }),
});

export const createProgramme = endpoint({
  method: "POST",
  path: "/programmes",
  summary: "Create a programme",
  tag: "Academic",
  auth: "session",
  permission: "academic:structure:manage",
  body: z.object(programmeFields).strict(),
  response: programmeSchema,
});

export const updateProgramme = endpoint({
  method: "PATCH",
  path: "/programmes/:id",
  summary: "Rename or archive a programme",
  tag: "Academic",
  auth: "session",
  permission: "academic:structure:manage",
  resource: { type: "programme", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      name: programmeFields.name.optional(),
      status: z.enum(ENUMS["programmes.status"]).optional(),
    })
    .strict(),
  response: programmeSchema,
});

// ---- Courses ----

export const courseSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  credits: z.string(),
  status: z.enum(ENUMS["courses.status"]),
  version: z.number().int(),
});

export type Course = z.infer<typeof courseSchema>;

export const listCourses = endpoint({
  method: "GET",
  path: "/courses",
  summary: "The course catalogue, searchable by code or title",
  tag: "Academic",
  auth: "session",
  permission: "academic:structure:read",
  query: pageQuery.extend({
    q: z.string().trim().min(1).max(100).optional(),
    status: z.enum(ENUMS["courses.status"]).optional(),
  }),
  response: page(courseSchema),
});

export const createCourse = endpoint({
  method: "POST",
  path: "/courses",
  summary: "Add a course to the catalogue",
  tag: "Academic",
  auth: "session",
  permission: "academic:structure:manage",
  body: z
    .object({
      code,
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(4000).nullable().default(null),
      credits,
    })
    .strict(),
  response: courseSchema,
});

export const updateCourse = endpoint({
  method: "PATCH",
  path: "/courses/:id",
  summary: "Edit or archive a course",
  tag: "Academic",
  auth: "session",
  permission: "academic:structure:manage",
  resource: { type: "course", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().trim().max(4000).nullable().optional(),
      credits: credits.optional(),
      status: z.enum(ENUMS["courses.status"]).optional(),
    })
    .strict(),
  response: courseSchema,
});

// ---- Curricula ----

export const placementSchema = z.object({
  courseId: z.uuid(),
  courseCode: z.string(),
  courseTitle: z.string(),
  /** Its place in the default order, from 1 (ADR-0005). */
  position: z.number().int(),
  /** The credits this placement counts for: the override, or the course's own. */
  credits: z.string(),
  creditOverride: z.string().nullable(),
});

export const curriculumSchema = z.object({
  id: z.uuid(),
  programmeId: z.uuid(),
  curriculumVersion: z.number().int(),
  effectiveFrom: z.iso.date(),
  status: z.enum(ENUMS["curricula.status"]),
  /** The credits of all its courses; the Certificate needs half of them passed. */
  totalCredits: z.string(),
  version: z.number().int(),
  placementCount: z.number().int(),
});

export const curriculumDetailSchema = curriculumSchema.extend({
  /** True when the curriculum can't be changed (`CURRICULUM_LOCKED`). */
  locked: z.boolean(),
  placements: z.array(placementSchema),
});

export type Curriculum = z.infer<typeof curriculumSchema>;
export type CurriculumDetail = z.infer<typeof curriculumDetailSchema>;

export const listCurricula = endpoint({
  method: "GET",
  path: "/curricula",
  summary: "Curriculum versions, optionally for one programme",
  tag: "Academic",
  auth: "session",
  permission: "academic:structure:read",
  query: z.object({ programmeId: z.uuid().optional() }),
  response: z.object({ items: z.array(curriculumSchema) }),
});

export const getCurriculum = endpoint({
  method: "GET",
  path: "/curricula/:id",
  summary: "A curriculum with its placements",
  tag: "Academic",
  auth: "session",
  permission: "academic:structure:read",
  resource: { type: "curriculum", param: "id" },
  params: idParams,
  response: curriculumDetailSchema,
});

export const createCurriculum = endpoint({
  method: "POST",
  path: "/curricula",
  summary: "Start a new draft curriculum version for a programme",
  tag: "Academic",
  auth: "session",
  permission: "academic:structure:manage",
  body: z
    .object({
      programmeId: z.uuid(),
      effectiveFrom: z.iso.date(),
    })
    .strict(),
  response: curriculumDetailSchema,
});

export const updateCurriculum = endpoint({
  method: "PATCH",
  path: "/curricula/:id",
  summary: "Change a curriculum's start date",
  tag: "Academic",
  auth: "session",
  permission: "academic:structure:manage",
  resource: { type: "curriculum", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z.object({ effectiveFrom: z.iso.date().optional() }).strict(),
  response: curriculumDetailSchema,
});

export const putPlacements = endpoint({
  method: "PUT",
  path: "/curricula/:id/courses",
  summary: "Replace the curriculum's courses, in their default order",
  tag: "Academic",
  auth: "session",
  permission: "academic:structure:manage",
  resource: { type: "curriculum", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      /** In the default order: the first is position 1. */
      placements: z
        .array(
          z
            .object({
              courseId: z.uuid(),
              creditOverride: credits.nullable().default(null),
            })
            .strict(),
        )
        .max(200),
    })
    .strict(),
  response: curriculumDetailSchema,
});

export const activateCurriculum = endpoint({
  method: "POST",
  path: "/curricula/:id/activate",
  summary: "Make this draft the programme's active curriculum (the previous one is retired)",
  tag: "Academic",
  auth: "session",
  permission: "academic:structure:manage",
  resource: { type: "curriculum", param: "id" },
  params: idParams,
  response: curriculumDetailSchema,
  successStatus: 200,
});

export const cloneCurriculum = endpoint({
  method: "POST",
  path: "/curricula/:id/clone",
  summary: "Copy this curriculum into a new draft version",
  tag: "Academic",
  auth: "session",
  permission: "academic:structure:manage",
  resource: { type: "curriculum", param: "id" },
  params: idParams,
  body: z.object({ effectiveFrom: z.iso.date() }).strict(),
  response: curriculumDetailSchema,
});
