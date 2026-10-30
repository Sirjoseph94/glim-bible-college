import type { CourseResultRow, MyResults, results } from "@glim/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { GpaSummary, ResultRow } from "../components/app/results";
import { Banner } from "../components/ui/banner";
import { Card } from "../components/ui/card";
import { EmptyState } from "../components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { TranscriptsSection } from "./transcripts";

const KIND_LABELS: Record<CourseResultRow["resultKind"], string> = {
  GRADED: "",
  INCOMPLETE: "Incomplete",
  WITHDRAWN: "Withdrawn",
  EXEMPT: "Exempt",
  AUDIT: "Audit",
};

/**
 * A student's (or graduate's) results (docs/ui-design-handoff.md §11.6, ADR-0005): the CGPA first,
 * then every course result in the order completed, then transcripts (decision UI-Q8).
 */
export function MyResultsPage() {
  const mine = useQuery({
    queryKey: ["my-results"],
    queryFn: ({ signal }) => api<typeof results.getMyResults>("GET", "/me/results", { signal }),
  });
  if (mine.isPending)
    return (
      <SkeletonGroup label="Loading your results">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-36" />
        <Skeleton className="h-48" />
      </SkeletonGroup>
    );
  if (mine.isError) return <LoadFailed what="your results" onRetry={() => void mine.refetch()} />;
  const programmes = mine.data.programmes;
  const matric = programmes.length === 1 ? programmes[0]?.matricNumber : undefined;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Results"
        actions={
          matric ? <span className="font-mono text-code text-ink-muted">{matric}</span> : undefined
        }
      />
      {programmes.every((p) => p.results.length === 0) ? (
        <EmptyState icon="award" title="No results yet">
          Results appear here as soon as your Lecturers finalize them.
        </EmptyState>
      ) : (
        programmes.map((p) => (
          <ProgrammeResults
            key={p.programmeEnrollmentId}
            programme={p}
            showName={programmes.length > 1}
          />
        ))
      )}
      <TranscriptsSection programmes={programmes} />
    </div>
  );
}

const STANDING_LABELS: Record<string, string> = {
  GOOD: "Good standing",
  PROBATION: "Probation",
  WITHDRAW_REQUIRED: "Below good standing",
  UNKNOWN: "",
};

function ProgrammeResults({
  programme: p,
  showName,
}: {
  programme: MyResults["programmes"][number];
  showName: boolean;
}) {
  if (p.results.length === 0) return null;
  const standing = STANDING_LABELS[p.summary.standing] ?? "";
  return (
    <div className="space-y-4">
      {showName ? (
        <h2 className="text-heading">
          {p.programmeName}{" "}
          <span className="font-mono text-code text-ink-muted">{p.matricNumber}</span>
        </h2>
      ) : null}
      <GpaSummary
        cgpaX100={p.summary.cgpaX100}
        provisional={p.summary.provisional}
        earnedX10={p.summary.creditsEarnedX10}
        attemptedX10={p.summary.creditsAttemptedX10}
      />
      {p.summary.provisional ? (
        <Banner tone="info" title="Your CGPA is provisional">
          It becomes official once the Registrar has approved every result it counts.
        </Banner>
      ) : null}
      <section className="space-y-2" aria-label="Course results">
        <h2 className="text-heading">Courses, latest first</h2>
        <Card list>
          {[...p.results].reverse().map((c) => (
            <ResultRow
              key={c.id}
              code={c.courseCode}
              title={c.courseTitle}
              creditsX10={c.creditsX10}
              letter={c.letter}
              pctX100={c.finalPctX100}
              pending={c.resultKind === "GRADED" && c.letter === null && c.finalPctX100 === null}
              note={[
                `Completed ${c.completedOn}`,
                c.attemptNo > 1 ? "Repeat · your best attempt counts" : null,
                KIND_LABELS[c.resultKind] === "" ? null : KIND_LABELS[c.resultKind],
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </Card>
        {standing === "" ? null : <p className="text-body-sm text-ink-muted">{standing}</p>}
      </section>
    </div>
  );
}
