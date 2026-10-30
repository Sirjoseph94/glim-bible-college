import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";
import { offeringSchema } from "./offerings";

const idParams = z.object({ id: z.uuid() });

/**
 * Cohorts and their Cohort Schedules (ADR-0005): the students of one intake work through the
 * curriculum one course at a time, in offerings the Academic Admin dates for that cohort.
 */
export const cohortSchema = z.object({
  id: z.uuid(),
  programmeId: z.uuid(),
  programmeName: z.string(),
  intakeId: z.uuid(),
  intakeCode: z.string(),
  /** The intake's start date: no offering of the cohort may start before it. */
  startsOn: z.iso.date(),
  code: z.string(),
  name: z.string(),
  status: z.enum(ENUMS["cohorts.status"]),
  /** ACTIVE programme enrollments in the cohort. */
  activeStudents: z.number().int(),
});

export type Cohort = z.infer<typeof cohortSchema>;

export const cohortScheduleSchema = z.object({
  cohort: cohortSchema,
  /** The cohort's offerings by start date, cancelled ones included. */
  offerings: z.array(offeringSchema),
  /** Courses of the cohort's curriculum with no live offering yet, in curriculum order. */
  unscheduled: z.array(
    z.object({ courseId: z.uuid(), courseCode: z.string(), courseTitle: z.string() }),
  ),
});

export type CohortSchedule = z.infer<typeof cohortScheduleSchema>;

export const listCohorts = endpoint({
  method: "GET",
  path: "/cohorts",
  summary: "Cohorts, newest intake first",
  tag: "Academic",
  auth: "session",
  permission: "academic:structure:read",
  query: z.object({ status: z.enum(ENUMS["cohorts.status"]).optional() }),
  response: z.object({ items: z.array(cohortSchema) }),
});

export const getCohortSchedule = endpoint({
  method: "GET",
  path: "/cohorts/:id/schedule",
  summary: "A cohort's offerings in order, and the curriculum courses not yet scheduled",
  tag: "Academic",
  auth: "session",
  permission: "academic:structure:read",
  resource: { type: "cohort", param: "id" },
  params: idParams,
  response: cohortScheduleSchema,
});

export const planCohortSchedule = endpoint({
  method: "POST",
  path: "/cohorts/:id/schedule",
  summary:
    "Create draft offerings for the unscheduled curriculum courses, end to end in curriculum order",
  tag: "Academic",
  auth: "session",
  permission: "academic:course-offering:manage",
  resource: { type: "cohort", param: "id" },
  params: idParams,
  body: z
    .object({
      /** The first new offering's start; the rest follow it end to end. */
      startsOn: z.iso.date(),
      /** Each offering's length; its exam is on its last day. */
      weeksPerCourse: z.number().int().min(1).max(26),
    })
    .strict(),
  response: cohortScheduleSchema,
});
