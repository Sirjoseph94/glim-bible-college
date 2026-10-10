import type { Offering } from "@glim/contracts";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cardClass } from "../ui/card";

/**
 * A course the person takes (§9.15): the whole card links to the course page. The band carries
 * the course code and, when there is one, the state of its next Class Meeting. ("Recordings
 * watched" waits on data the API doesn't return yet: .scratch/ui-overhaul/issues/02.)
 */
export function CourseCard({ offering, badge }: { offering: Offering; badge?: ReactNode }) {
  const lecturers = offering.lecturers
    .filter((l) => l.status === "ACTIVE")
    .map((l) => l.lecturerName)
    .join(", ");
  return (
    <Link
      to="/courses/$offeringId"
      params={{ offeringId: offering.id }}
      className={`${cardClass({ interactive: true, list: true })} block`}
    >
      <div className="flex items-center justify-between gap-2 bg-brand-soft px-4 py-3">
        <span className="font-mono text-code font-semibold text-brand">{offering.courseCode}</span>
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
          {offering.semesterName}, {offering.sessionCode} · {offering.credits} credits
        </p>
      </div>
    </Link>
  );
}
