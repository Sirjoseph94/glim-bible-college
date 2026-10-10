/** A Lecturer's course page tabs (§11.9, decision UI-Q5), kept apart so the router can check `?tab=`. */
export const TEACH_TABS = [
  "overview",
  "live",
  "recordings",
  "work",
  "gradebook",
  "materials",
] as const;
export type TeachTab = (typeof TEACH_TABS)[number];
