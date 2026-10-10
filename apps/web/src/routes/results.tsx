import type { CourseResultRow, MyResults, results } from "@glim/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { hundredths } from "../design/format";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { GpaSummary, ResultRow } from "../components/app/results";
import { Banner } from "../components/ui/banner";
import { Card } from "../components/ui/card";
import { Disclosure } from "../components/ui/disclosure";
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
 * A student's (or graduate's) results (docs/ui-design-handoff.md §11.6): the latest semester's
 * GPA and CGPA first, its course results, earlier semesters folded away, then transcripts
 * (decision UI-Q8).
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
      {programmes.every((p) => p.semesters.length === 0) ? (
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

type MySemester = MyResults["programmes"][number]["semesters"][number];

function SemesterRows({ semester }: { semester: MySemester }) {
  return (
    <Card list>
      {semester.results.map((c) => (
        <ResultRow
          key={c.id}
          code={c.courseCode}
          title={c.courseTitle}
          creditsX10={c.creditsX10}
          letter={c.letter}
          pctX100={c.finalPctX100}
          pending={c.resultKind === "GRADED" && c.letter === null && c.finalPctX100 === null}
          note={
            c.attemptNo > 1
              ? "Repeat · your best attempt counts"
              : KIND_LABELS[c.resultKind] === ""
                ? undefined
                : KIND_LABELS[c.resultKind]
          }
        />
      ))}
    </Card>
  );
}

function ProgrammeResults({
  programme: p,
  showName,
}: {
  programme: MyResults["programmes"][number];
  showName: boolean;
}) {
  const latest = p.semesters.at(-1);
  if (latest === undefined) return null;
  const earlier = p.semesters.slice(0, -1).reverse();
  const standing = STANDING_LABELS[latest.standing] ?? "";
  return (
    <div className="space-y-4">
      {showName ? (
        <h2 className="text-heading">
          {p.programmeName}{" "}
          <span className="font-mono text-code text-ink-muted">{p.matricNumber}</span>
        </h2>
      ) : null}
      <GpaSummary
        gpaX100={latest.gpaX100}
        cgpaX100={latest.cgpaX100}
        provisional={latest.provisional}
        earnedX10={latest.creditsEarnedX10}
        attemptedX10={latest.creditsAttemptedX10}
      />
      {latest.provisional ? (
        <Banner tone="info" title="These results are provisional">
          They become official when the Registrar approves and publishes the semester.
        </Banner>
      ) : null}
      <section className="space-y-2" aria-label={`${latest.semesterName} ${latest.sessionCode}`}>
        <h2 className="text-heading">
          This semester · {latest.semesterName}, {latest.sessionCode}
        </h2>
        <SemesterRows semester={latest} />
        {standing === "" ? null : <p className="text-body-sm text-ink-muted">{standing}</p>}
      </section>
      {earlier.map((s) => (
        <Disclosure
          key={s.semesterId}
          summary={`${s.semesterName}, ${s.sessionCode} · GPA ${hundredths(s.gpaX100)}`}
        >
          <div aria-label={`${s.semesterName} ${s.sessionCode}`}>
            <SemesterRows semester={s} />
          </div>
        </Disclosure>
      ))}
    </div>
  );
}
