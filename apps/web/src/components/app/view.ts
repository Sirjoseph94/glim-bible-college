import { useSyncExternalStore } from "react";

/** Which Home a person who is both a student and a Lecturer sees (handoff §6.3). */
export type HomeView = "student" | "lecturer";

interface Roles {
  isStudent: boolean;
  isLecturer: boolean;
}

const STORAGE_KEY = "glim.view";
const CHANGED = "glim:view-changed";

/** The Home to show: the role held, or for both roles the stored choice (student by default). */
export function homeView(roles: Roles, stored: HomeView | null): HomeView | null {
  if (roles.isStudent && roles.isLecturer) return stored ?? "student";
  if (roles.isStudent) return "student";
  if (roles.isLecturer) return "lecturer";
  return null;
}

/** The top bar says so (§6.3: "Lecturer view" text, never a badge) when it isn't the default. */
export function isAlternateView(roles: Roles, stored: HomeView | null): boolean {
  return roles.isStudent && roles.isLecturer && homeView(roles, stored) === "lecturer";
}

/** The choice when storage is refused (some private windows): kept until the page reloads. */
let inMemory: HomeView | null = null;

function readStored(): HomeView | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "student" || value === "lecturer" ? value : inMemory;
  } catch {
    return inMemory;
  }
}

/** Remembers the choice on this device; private windows that refuse storage keep the default. */
export function chooseView(view: HomeView): void {
  inMemory = view;
  try {
    window.localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // Storage refused: `inMemory` holds it.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The stored choice, live across tabs. */
export function useStoredView(): HomeView | null {
  return useSyncExternalStore(subscribe, readStored, () => null);
}
