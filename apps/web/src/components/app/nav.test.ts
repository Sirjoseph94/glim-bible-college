import type { Me } from "@glim/contracts";
import { describe, expect, it } from "vitest";
import { activeItem, navItems, sectionLinks } from "./nav";

type Roles = Me["roles"];
const none: Roles = {
  staff: [],
  isLecturer: false,
  isStudent: false,
  isAlumnus: false,
  isApplicant: false,
};
const labels = (roles: Roles) => navItems(roles).map((i) => i.label);

describe("navItems (handoff §6.3, decision D-UI-01)", () => {
  it("gives a student Home, Courses, Schedule, Results and Profile (§6.3)", () => {
    expect(labels({ ...none, isStudent: true })).toEqual([
      "Home",
      "Courses",
      "Schedule",
      "Results",
      "Profile",
    ]);
  });

  it("gives a Lecturer Home, Teaching, Schedule and Profile (§6.3)", () => {
    expect(labels({ ...none, isLecturer: true })).toEqual([
      "Home",
      "Teaching",
      "Schedule",
      "Profile",
    ]);
  });

  it("gives a graduate their results, and an applicant their application", () => {
    expect(labels({ ...none, isAlumnus: true })).toEqual(["Home", "Results", "Profile"]);
    expect(labels({ ...none, isApplicant: true })).toEqual(["Home", "Application", "Profile"]);
  });

  it("gives the Registrar the results area, pointing at cohort results", () => {
    const items = navItems({ ...none, staff: ["REGISTRAR"] });
    expect(items.map((i) => i.label)).toEqual(["Home", "Results", "Profile"]);
    expect(items[1]?.to).toBe("/results/cohorts");
  });

  it("gives a System Admin every staff area, Ops last before Profile", () => {
    expect(labels({ ...none, staff: ["SYSTEM_ADMIN"] })).toEqual([
      "Home",
      "Admissions",
      "Academic",
      "Results",
      "People",
      "Settings",
      "Ops",
      "Profile",
    ]);
  });

  it("merges the areas of someone with several roles, without repeats", () => {
    expect(labels({ ...none, isLecturer: true, staff: ["ACADEMIC_ADMIN", "REGISTRAR"] })).toEqual([
      "Home",
      "Teaching",
      "Schedule",
      "Academic",
      "Results",
      "Profile",
    ]);
  });
});

describe("activeItem", () => {
  const admin = navItems({ ...none, staff: ["SYSTEM_ADMIN"] });

  it("marks the area a page belongs to, not just its first page", () => {
    expect(activeItem("/admin/cohorts", admin)?.label).toBe("Academic");
    expect(activeItem("/admin/curricula/abc", admin)?.label).toBe("Academic");
    expect(activeItem("/results/awards", admin)?.label).toBe("Results");
    expect(activeItem("/admin/users/123", admin)?.label).toBe("People");
    expect(activeItem("/admin/jobs", admin)?.label).toBe("Ops");
    expect(activeItem("/", admin)?.label).toBe("Home");
  });

  it("marks nothing on a page outside every area", () => {
    expect(activeItem("/notifications", admin)).toBeUndefined();
  });

  it("gives a student who teaches one Schedule, between Teaching and Results", () => {
    expect(labels({ ...none, isStudent: true, isLecturer: true })).toEqual([
      "Home",
      "Courses",
      "Teaching",
      "Schedule",
      "Results",
      "Profile",
    ]);
  });

  it("puts a student's course pages under Courses and transcripts under Results", () => {
    const student = navItems({ ...none, isStudent: true });
    expect(activeItem("/registration", student)?.label).toBe("Courses");
    expect(activeItem("/transcripts", student)?.label).toBe("Results");
  });
});

describe("sectionLinks", () => {
  it("lists an area's pages the person may open, on any page of the area", () => {
    expect(sectionLinks("/admin/imports", { ...none, staff: ["ACADEMIC_ADMIN"] })).toEqual([
      { label: "Setup", to: "/admin/academic" },
      { label: "Cohorts", to: "/admin/cohorts" },
      { label: "Offerings", to: "/admin/offerings" },
      { label: "Rooms", to: "/admin/rooms" },
      { label: "Lecturers", to: "/admin/lecturers" },
      { label: "Imports", to: "/admin/imports" },
    ]);
  });

  it("leaves out pages the person's roles don't reach", () => {
    expect(
      sectionLinks("/results/cohorts", { ...none, staff: ["ACADEMIC_ADMIN"] }).map((l) => l.label),
    ).toEqual(["Course results", "Cohort results"]);
  });

  it("is empty for a page that isn't in an area with several pages", () => {
    expect(sectionLinks("/profile", { ...none, isStudent: true })).toEqual([]);
    expect(sectionLinks("/", { ...none, staff: ["SYSTEM_ADMIN"] })).toEqual([]);
  });
});
