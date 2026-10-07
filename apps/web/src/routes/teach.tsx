import type { offerings } from "@glim/contracts";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { Alert } from "../components/form";

const myOfferingsQuery = queryOptions({
  queryKey: ["offerings", "mine"],
  queryFn: ({ signal }) =>
    api<typeof offerings.listOfferings>("GET", "/course-offerings", { signal }),
});

const ROLE_LABELS: Record<string, string> = {
  PRIMARY: "Primary Lecturer",
  CO_LECTURER: "Co-lecturer",
  ASSISTANT: "Assistant",
  GUEST_LECTURER: "Guest lecturer",
};

/** A Lecturer's "My offerings": the Course Offerings they're assigned to (TRD §18.2 /teach). */
export function TeachPage() {
  const list = useQuery(myOfferingsQuery);
  if (list.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (list.isError) return <Alert tone="error">{list.error.message}</Alert>;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">My offerings</h2>
      {list.data.items.length === 0 ? (
        <p className="text-slate-600">You aren't assigned to any Course Offerings yet.</p>
      ) : null}
      <ul className="space-y-2">
        {list.data.items.map((o) => (
          <li key={o.id} className="rounded border border-slate-200 bg-white p-3">
            <div className="font-medium">
              {o.courseCode} {o.title}{" "}
              <span className="font-normal text-slate-600">({o.sectionCode})</span>
            </div>
            <div className="text-sm text-slate-600">
              {o.semesterName}, {o.sessionCode} · {o.status.toLowerCase()}
            </div>
            <div className="text-sm text-slate-600">
              {o.lecturers
                .map((l) => `${l.lecturerName} (${ROLE_LABELS[l.role] ?? l.role})`)
                .join(", ")}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
