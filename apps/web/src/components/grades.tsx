import type { assessment } from "@glim/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { SafeHtml } from "./course-content";
import { Time } from "./time";

/** The student's released grades on a course (TRD §14.2); drafts never reach the browser. */
export function MyGrades({ offeringId }: { offeringId: string }) {
  const list = useQuery({
    queryKey: ["my-grades", offeringId],
    queryFn: ({ signal }) =>
      api<typeof assessment.getMyGrades>("GET", "/course-offerings/:id/my-grades", {
        params: { id: offeringId },
        signal,
      }),
  });
  if (list.isPending) return <div className="h-10 animate-pulse rounded bg-slate-200" />;
  if (list.isError) return <p className="text-red-700">We couldn't load your grades.</p>;
  const items = list.data.items;
  if (items.length === 0) return <p className="text-slate-600">No grades released yet.</p>;
  return (
    <ul className="space-y-2">
      {items.map((g) => (
        <li
          key={g.assessmentId}
          className="rounded border border-slate-200 p-2"
          aria-label={g.title}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{g.title}</span>
            <span>
              {g.excused ? "Excused" : `${g.score ?? "–"} / ${g.maxScore}`}
              <span className="text-slate-600"> · counts {g.weight} %</span>
            </span>
          </div>
          {g.releasedAt === null ? null : (
            <div className="text-xs text-slate-500">
              Released <Time value={g.releasedAt} />
            </div>
          )}
          {g.feedbackHtml === null ? null : (
            <div className="mt-1 rounded bg-slate-50 p-2">
              <SafeHtml html={g.feedbackHtml} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
