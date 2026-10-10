import type { ClassMeeting, meetings } from "@glim/contracts";
import { queryOptions } from "@tanstack/react-query";
import { api } from "../api/client";

export type ScheduleItem = ClassMeeting & { as: "STUDENT" | "LECTURER" };

/** The signed-in user's Class Meetings for the next two weeks (`GET /me/schedule`). */
export const myScheduleQuery = queryOptions({
  queryKey: ["me", "schedule"],
  queryFn: ({ signal }) => api<typeof meetings.getMySchedule>("GET", "/me/schedule", { signal }),
});
