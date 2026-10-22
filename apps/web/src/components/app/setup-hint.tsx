import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { meQuery } from "../../api/session";
import type { StaffRole } from "../../api/users";

/** Where each kind of set-up happens, and who may open that page (the guards in router.tsx). */
const PLACES = {
  calendar: {
    to: "/admin/calendar",
    page: "Academic calendar",
    roles: ["SYSTEM_ADMIN", "ACADEMIC_ADMIN"],
    owner: "an Academic Admin",
  },
  academic: {
    to: "/admin/academic",
    page: "Programmes and courses",
    roles: ["SYSTEM_ADMIN", "ACADEMIC_ADMIN"],
    owner: "an Academic Admin",
  },
  lecturers: {
    to: "/admin/lecturers",
    page: "Lecturers",
    roles: ["SYSTEM_ADMIN", "ACADEMIC_ADMIN"],
    owner: "an Academic Admin",
  },
} as const satisfies Record<
  string,
  { to: string; page: string; roles: readonly StaffRole[]; owner: string }
>;

export type SetupPlace = keyof typeof PLACES;

/**
 * Why a list has nothing to choose, and how to fix it: a link to the page where it's set up if
 * the viewer can open it, otherwise who to ask. Pass it as a field's `hint` when the list is empty.
 */
export function SetupHint({
  missing,
  fix,
  place,
}: {
  /** What isn't there yet, as a sentence: "No upcoming Academic Session yet." */
  missing: string;
  /** What to do, lower-case: "create one". */
  fix: string;
  place: SetupPlace;
}) {
  const me = useQuery(meQuery);
  const p = PLACES[place];
  const canFix = me.data?.roles.staff.some((r) => (p.roles as readonly StaffRole[]).includes(r));
  return canFix ? (
    <>
      {missing} {fix.charAt(0).toUpperCase() + fix.slice(1)} on the{" "}
      <Link to={p.to} className="text-brand underline">
        {p.page}
      </Link>{" "}
      page.
    </>
  ) : (
    <>
      {missing} Ask {p.owner} to {fix} on the {p.page} page.
    </>
  );
}
