import { describe, expect, it } from "vitest";
import { homeView, isAlternateView } from "./view";

const roles = (isStudent: boolean, isLecturer: boolean) => ({ isStudent, isLecturer });

describe("homeView (handoff §6.3: a role switcher for people with two roles)", () => {
  it("is the one role a person holds, whatever is stored", () => {
    expect(homeView(roles(true, false), "lecturer")).toBe("student");
    expect(homeView(roles(false, true), "student")).toBe("lecturer");
  });

  it("is the student view by default for a student who also teaches", () => {
    expect(homeView(roles(true, true), null)).toBe("student");
  });

  it("follows the stored choice when the person holds both roles", () => {
    expect(homeView(roles(true, true), "lecturer")).toBe("lecturer");
  });

  it("is null for staff and applicants, whose Home lists their areas", () => {
    expect(homeView(roles(false, false), "lecturer")).toBeNull();
  });

  it("marks only a chosen, non-default view", () => {
    expect(isAlternateView(roles(true, true), "lecturer")).toBe(true);
    expect(isAlternateView(roles(true, true), null)).toBe(false);
    expect(isAlternateView(roles(false, true), "lecturer")).toBe(false);
  });
});
