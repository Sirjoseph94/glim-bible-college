import type { Me, StaffRole } from "@glim/contracts";
import type { LinkProps } from "@tanstack/react-router";
import type { IconName } from "../../design/icons";

type Roles = Me["roles"];

/** A path the router knows, so a typo fails the typecheck. */
type To = NonNullable<LinkProps["to"]>;

export interface NavItem {
  label: string;
  to: To;
  icon: IconName;
}

export interface SectionLink {
  label: string;
  to: To;
}

interface Page extends SectionLink {
  /** Who may open it; everyone who sees the area when absent. */
  staff?: StaffRole[];
}

interface Area extends NavItem {
  shows: (roles: Roles) => boolean;
  /** Paths that belong to the area: the path itself and anything under it. */
  covers: string[];
  /** Paths that belong to it only exactly (so `/results` doesn't claim `/results/awards`). */
  exactly?: string[];
  /** The area's pages, shown as links on each of them when there is more than one. */
  pages?: Page[];
}

function holdsAny(roles: Roles, wanted: StaffRole[]): boolean {
  return roles.staff.some((role) => wanted.includes(role));
}

const staff =
  (...wanted: StaffRole[]) =>
  (roles: Roles) =>
    holdsAny(roles, wanted);

/**
 * The main navigation (docs/ui-design-handoff.md §6.3, decisions UI-Q6 and D-UI-01): an area
 * for each role a person holds, in this order, Home first and Profile last. An area with
 * several pages shows them as links on each (`sectionLinks`), so every page stays reachable
 * without crowding the bottom bar.
 */
const AREAS: Area[] = [
  { label: "Home", to: "/", icon: "home", shows: () => true, covers: [], exactly: ["/"] },
  {
    label: "Courses",
    to: "/courses",
    icon: "book",
    shows: (r) => r.isStudent,
    covers: ["/courses", "/registration", "/assignments", "/quizzes", "/recordings"],
    pages: [
      { label: "My courses", to: "/courses" },
      { label: "Registration", to: "/registration" },
    ],
  },
  {
    label: "Results",
    to: "/results",
    icon: "award",
    shows: (r) => r.isStudent || r.isAlumnus,
    covers: ["/transcripts", "/course-results"],
    exactly: ["/results"],
    pages: [
      { label: "My results", to: "/results" },
      { label: "Transcripts", to: "/transcripts" },
    ],
  },
  {
    label: "Application",
    to: "/application",
    icon: "file",
    shows: (r) => r.isApplicant,
    covers: ["/application"],
  },
  { label: "Teaching", to: "/teach", icon: "book", shows: (r) => r.isLecturer, covers: ["/teach"] },
  {
    label: "Admissions",
    to: "/admissions",
    icon: "file",
    shows: staff("SYSTEM_ADMIN", "ADMISSIONS_OFFICER"),
    covers: ["/admissions"],
    pages: [
      { label: "Applications", to: "/admissions" },
      { label: "Intakes", to: "/admissions/intakes" },
      { label: "Reports", to: "/admissions/reports" },
    ],
  },
  {
    label: "Academic",
    to: "/admin/academic",
    icon: "calendar",
    shows: staff("SYSTEM_ADMIN", "ACADEMIC_ADMIN"),
    covers: [
      "/admin/academic",
      "/admin/curricula",
      "/admin/calendar",
      "/admin/offerings",
      "/admin/lecturers",
      "/admin/imports",
    ],
    pages: [
      { label: "Setup", to: "/admin/academic" },
      { label: "Calendar", to: "/admin/calendar" },
      { label: "Offerings", to: "/admin/offerings" },
      { label: "Lecturers", to: "/admin/lecturers" },
      { label: "Imports", to: "/admin/imports" },
    ],
  },
  {
    label: "Results",
    to: "/results/semesters",
    icon: "award",
    shows: staff("SYSTEM_ADMIN", "REGISTRAR", "ACADEMIC_ADMIN"),
    covers: ["/results/courses", "/results/semesters", "/results/awards", "/results/transcripts"],
    exactly: ["/admin/grading-schemes"],
    pages: [
      { label: "Course results", to: "/results/courses" },
      { label: "Semester results", to: "/results/semesters" },
      { label: "Awards", to: "/results/awards", staff: ["SYSTEM_ADMIN", "REGISTRAR"] },
      {
        label: "Transcript requests",
        to: "/results/transcripts",
        staff: ["SYSTEM_ADMIN", "REGISTRAR"],
      },
      {
        label: "Grading schemes",
        to: "/admin/grading-schemes",
        staff: ["SYSTEM_ADMIN", "REGISTRAR"],
      },
    ],
  },
  {
    label: "People",
    to: "/admin/users",
    icon: "users",
    shows: staff("SYSTEM_ADMIN"),
    covers: ["/admin/users"],
  },
  {
    label: "Settings",
    to: "/admin/settings",
    icon: "settings",
    shows: staff("SYSTEM_ADMIN"),
    covers: ["/admin/settings", "/admin/videos", "/admin/audit"],
    pages: [
      { label: "General", to: "/admin/settings" },
      { label: "Videos", to: "/admin/videos" },
      { label: "Audit log", to: "/admin/audit" },
    ],
  },
  {
    label: "Ops",
    to: "/admin/ops",
    icon: "alert",
    shows: staff("SYSTEM_ADMIN"),
    covers: ["/admin/ops", "/admin/jobs"],
    pages: [
      { label: "Failures", to: "/admin/ops" },
      { label: "Job queues", to: "/admin/jobs" },
    ],
  },
  { label: "Profile", to: "/profile", icon: "user", shows: () => true, covers: ["/profile"] },
];

function visibleAreas(roles: Roles): Area[] {
  return AREAS.filter((area) => area.shows(roles));
}

function areaFor(pathname: string, areas: Area[]): Area | undefined {
  return areas.find(
    (area) =>
      (area.exactly ?? []).includes(pathname) ||
      area.covers.some((path) => pathname === path || pathname.startsWith(`${path}/`)),
  );
}

/** The person's main navigation items, in order. */
export function navItems(roles: Roles): NavItem[] {
  return visibleAreas(roles).map(({ label, to, icon }) => ({ label, to, icon }));
}

/** The item for the area the page belongs to, if any. */
export function activeItem(pathname: string, items: NavItem[]): NavItem | undefined {
  const area = areaFor(
    pathname,
    AREAS.filter((a) => items.some((item) => item.to === a.to)),
  );
  return area ? items.find((item) => item.to === area.to) : undefined;
}

/** The other pages of the page's area that the person may open; empty when there are none. */
export function sectionLinks(pathname: string, roles: Roles): SectionLink[] {
  const pages = (areaFor(pathname, visibleAreas(roles))?.pages ?? []).filter(
    (page) => page.staff === undefined || holdsAny(roles, page.staff),
  );
  return pages.length > 1 ? pages.map(({ label, to }) => ({ label, to })) : [];
}
