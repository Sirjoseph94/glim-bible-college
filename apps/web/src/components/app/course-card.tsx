import type { Offering } from "@glim/contracts";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CalendarDate } from "../time";
import { cardClass } from "../ui/card";

const ROLE_LABELS: Record<string, string> = {
  PRIMARY: "Primary Lecturer",
  CO_LECTURER: "Co-lecturer",
  ASSISTANT: "Assistant",
  GUEST_LECTURER: "Guest lecturer",
};

/**
 * A course (§9.15): the whole card links to the course page, the student's or, with `teaching`,
 * the Lecturer's. The band carries the course code and, when there is one, the state of its next
 * Class Meeting. ("Recordings watched" waits on data the API doesn't return yet:
 * .scratch/ui-overhaul/issues/07.)
 */
export function CourseCard({
  offering,
  badge,
  teaching = false,
}: {
  offering: Offering;
  badge?: ReactNode;
  teaching?: boolean;
}) {
  // A Lecturer sees each colleague's role, as on the old teaching page.
  const lecturers = offering.lecturers
    .filter((l) => l.status === "ACTIVE")
    .map((l) =>
      teaching ? `${l.lecturerName} (${ROLE_LABELS[l.role] ?? l.role})` : l.lecturerName,
    )
    .join(", ");
  return (
    <Link
      to={teaching ? "/teach/$offeringId" : "/courses/$offeringId"}
      params={{ offeringId: offering.id }}
      className={`${cardClass({ interactive: true, list: true })} block`}
    >
      <div className="flex items-center justify-between gap-2 bg-brand-soft px-4 py-3">
        <span className="font-mono text-code font-semibold text-brand">
          {offering.courseCode}
          {teaching ? ` · ${offering.cohortCode}` : ""}
        </span>
        {badge}
      </div>
      <div className="space-y-1 p-4">
        <h3 className="line-clamp-2 text-heading text-ink">{offering.title}</h3>
        {lecturers ? (
          <p className="truncate text-body-sm text-ink-muted" title={lecturers}>
            {lecturers}
          </p>
        ) : null}
        <p className="text-body-sm text-ink-muted">
          <CalendarDate value={offering.startsOn} /> to <CalendarDate value={offering.endsOn} /> ·
          exam <CalendarDate value={offering.examOn} /> · {offering.credits} credits
        </p>
      </div>
    </Link>
  );
}
