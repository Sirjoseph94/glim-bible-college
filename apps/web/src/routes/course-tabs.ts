/** The course page's tabs (§11.3), kept apart so the router can check `?tab=` without loading the page. */
export const COURSE_TABS = [
  "overview",
  "live",
  "recordings",
  "work",
  "grades",
  "materials",
] as const;
export type CourseTab = (typeof COURSE_TABS)[number];
