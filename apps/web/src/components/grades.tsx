import type { assessment } from "@glim/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { LoadFailed } from "./app/page-states";
import { SafeHtml } from "./course-content";
import { Time } from "./time";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { EmptyState } from "./ui/empty-state";
import { Skeleton, SkeletonGroup } from "./ui/skeleton";

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
  if (list.isPending)
    return (
      <SkeletonGroup label="Loading your grades">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </SkeletonGroup>
    );
  if (list.isError) return <LoadFailed what="your grades" onRetry={() => void list.refetch()} />;
  const items = list.data.items;
  if (items.length === 0)
    return (
      <EmptyState icon="award" title="No grades released yet">
        Your Lecturer releases grades here once work is marked.
      </EmptyState>
    );
  return (
    <section className="space-y-2">
      <h2 className="text-heading">Released grades</h2>
      <Card list role="list">
        {items.map((g) => (
          <div
            key={g.assessmentId}
            role="listitem"
            aria-label={g.title}
            className="space-y-2 px-4 py-3"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-subhead text-ink">{g.title}</p>
                <p className="text-meta text-ink-muted">
                  Counts {g.weight}%
                  {g.releasedAt === null ? null : (
                    <>
                      {" "}
                      · Released <Time value={g.releasedAt} />
                    </>
                  )}
                </p>
              </div>
              {g.excused ? (
                <Badge status="excused" />
              ) : (
                <p className="text-subhead text-ink tabular-nums">
                  {g.score ?? "–"} / {g.maxScore}
                </p>
              )}
            </div>
            {g.feedbackHtml === null ? null : (
              <div className="rounded-md bg-surface-sunken p-3">
                <SafeHtml html={g.feedbackHtml} />
              </div>
            )}
          </div>
        ))}
      </Card>
    </section>
  );
}
