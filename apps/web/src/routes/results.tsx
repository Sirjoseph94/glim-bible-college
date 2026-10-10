import type {
  academic,
  calendar,
  CourseResultRow,
  MyResults,
  offerings,
  results,
  SemesterResultRow,
} from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api/client";
import { meQuery } from "../api/session";
import { Alert, formText } from "../components/form";
import { useSubmit } from "../components/use-submit";
import { credits, hundredths } from "../design/format";
import { PageHeader } from "../components/app/page-header";
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

const resultsKey = (offeringId: string) => ["course-results", offeringId];

/**
 * A course's results (TRD §14.3): a preview of what finalizing records, then the frozen results.
 * The PRIMARY Lecturer (or an Academic Admin) finalizes; the Registrar can reopen one result.
 */
export function CourseResultsPage() {
  const { offeringId } = useParams({ strict: false });
  const id = offeringId ?? "";
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);
  const canReopen =
    me.data?.roles.staff.some((r) => r === "REGISTRAR" || r === "SYSTEM_ADMIN") ?? false;
  const list = useQuery({
    queryKey: resultsKey(id),
    queryFn: ({ signal }) =>
      api<typeof results.listCourseResults>("GET", "/course-offerings/:id/results", {
        params: { id },
        signal,
      }),
  });
  const { busy, error, run } = useSubmit();
  const [confirming, setConfirming] = useState(false);
  if (list.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (list.isError) return <Alert tone="error">We couldn't load the results.</Alert>;
  const r = list.data;
  const pending = r.items.length - r.finalized;
  return (
    <div className="space-y-4">
      <h1 className="text-title">Course results</h1>
      <p className="text-sm text-slate-600">
        {r.finalized === 0
          ? "Nothing is finalized yet: this is what finalizing would record, from the gradebook as it is now."
          : `${String(r.finalized)} of ${String(r.items.length)} results finalized. Students see them straight away.`}
      </p>
      {r.blocker !== null ? <Alert tone="error">{r.blocker}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {pending > 0 && r.blocker === null ? (
        confirming ? (
          <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
            <p>
              Finalize {pending} result{pending === 1 ? "" : "s"}? Their grades lock: after this
              only the Registrar can reopen a result.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={busy}
                className="rounded bg-brand px-3 py-2 text-white disabled:opacity-60"
                onClick={() =>
                  void run(async () => {
                    await api<typeof results.finalizeCourseResults>(
                      "POST",
                      "/course-offerings/:id/results/finalize",
                      { params: { id }, headers: { "idempotency-key": crypto.randomUUID() } },
                    );
                    setConfirming(false);
                    await queryClient.invalidateQueries({ queryKey: resultsKey(id) });
                  })
                }
              >
                Finalize now
              </button>
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="rounded bg-brand px-3 py-2 text-white"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Finalize results
          </button>
        )
      ) : null}
      <ul className="space-y-2 text-sm">
        {r.items.map((item) => (
          <ResultItem
            key={item.courseEnrollmentId}
            item={item}
            offeringId={id}
            canReopen={canReopen}
          />
        ))}
      </ul>
    </div>
  );
}

function ResultItem({
  item,
  offeringId,
  canReopen,
}: {
  item: CourseResultRow;
  offeringId: string;
  canReopen: boolean;
}) {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  const [reopening, setReopening] = useState(false);
  const final = item.status !== null && item.status !== "DRAFT";
  return (
    <li
      className="space-y-1 rounded border border-slate-200 bg-white p-3"
      aria-label={item.studentName}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {item.studentName} <span className="font-normal text-slate-500">{item.matricNumber}</span>
        </span>
        <span>
          {hundredths(item.finalPctX100)} % · {item.letter ?? "–"}
          {KIND_LABELS[item.resultKind] === "" ? "" : ` · ${KIND_LABELS[item.resultKind]}`}
        </span>
      </div>
      <div className="text-slate-600">
        {final
          ? `Finalized${item.reopenedCount > 0 ? ` (reopened ${String(item.reopenedCount)}×)` : ""}`
          : item.status === "DRAFT"
            ? "Reopened: finalize again to record it"
            : "Preview"}{" "}
        · {credits(item.creditsX10)} credits
        {item.attemptNo > 1 ? ` · attempt ${String(item.attemptNo)}` : ""}
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {final && canReopen && item.id !== null ? (
        reopening ? (
          <form
            aria-label="Reopen result"
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = formText(new FormData(e.currentTarget), "reason");
              const resultId = item.id ?? "";
              void run(async () => {
                await api<typeof results.reopenCourseResult>("POST", "/course-results/:id/reopen", {
                  params: { id: resultId },
                  body: { reason },
                });
                setReopening(false);
                await queryClient.invalidateQueries({ queryKey: resultsKey(offeringId) });
              });
            }}
          >
            <label className="block">
              <span className="block text-slate-700">Reason</span>
              <input
                name="reason"
                required
                maxLength={500}
                className="block w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-brand px-3 py-2 text-white disabled:opacity-60"
            >
              Reopen
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="text-brand underline"
            onClick={() => {
              setReopening(true);
            }}
          >
            Reopen
          </button>
        )
      ) : null}
    </li>
  );
}

/** The Registrar's way in: every course offering, each linking to its results. */
export function ResultsCoursesPage() {
  const list = useQuery({
    queryKey: ["offerings", "all"],
    queryFn: ({ signal }) =>
      api<typeof offerings.listOfferings>("GET", "/course-offerings", { query: {}, signal }),
  });
  if (list.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (list.isError) return <Alert tone="error">We couldn't load the courses.</Alert>;
  return (
    <div className="space-y-4">
      <h1 className="text-title">Course results</h1>
      <ul className="space-y-2 text-sm">
        {list.data.items.map((o) => (
          <li key={o.id} className="rounded border border-slate-200 bg-white p-3">
            <Link
              to="/course-results/$offeringId"
              params={{ offeringId: o.id }}
              className="font-medium text-blue-700 underline"
            >
              {o.courseCode} {o.title}
            </Link>
            <div className="text-slate-600">
              {o.semesterName}, {o.sessionCode} · section {o.sectionCode}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A student's results (TRD §14.3, §14.5): each course as soon as it's finalized, and semester
 * GPA and CGPA, marked Provisional until the Registrar publishes the semester.
 */
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
  if (mine.isError)
    return (
      <Banner tone="danger" title="We couldn't load your results">
        Check your connection and try again.
      </Banner>
    );
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

const STATUS_LABELS: Record<SemesterResultRow["status"], string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  PUBLISHED: "Published",
};

/**
 * The Registrar's semester results (TRD §14.5): compute from course results, approve and publish
 * in bulk (all programmes or one), and download the broadsheet.
 */
export function SemesterResultsPage() {
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ["academic-sessions"],
    queryFn: ({ signal }) =>
      api<typeof calendar.listAcademicSessions>("GET", "/academic-sessions", { signal }),
  });
  const semesters = useQuery({
    queryKey: ["semesters", "all"],
    queryFn: ({ signal }) =>
      api<typeof calendar.listSemesters>("GET", "/semesters", { query: {}, signal }),
  });
  const programmes = useQuery({
    queryKey: ["programmes"],
    queryFn: ({ signal }) => api<typeof academic.listProgrammes>("GET", "/programmes", { signal }),
  });
  const [semesterId, setSemesterId] = useState("");
  const [programmeId, setProgrammeId] = useState("");
  const scope = { semesterId, ...(programmeId === "" ? {} : { programmeId }) };
  const listKey = ["semester-results", semesterId, programmeId];
  const list = useQuery({
    queryKey: listKey,
    enabled: semesterId !== "",
    queryFn: ({ signal }) =>
      api<typeof results.listSemesterResults>("GET", "/results/semesters", {
        query: scope,
        signal,
      }),
  });
  const { busy, error, run } = useSubmit();
  const [message, setMessage] = useState<string | null>(null);
  const sessionCode = (id: string) => sessions.data?.items.find((x) => x.id === id)?.code ?? "";
  const options = [...(semesters.data?.items ?? [])].sort((a, b) =>
    b.startsOn.localeCompare(a.startsOn),
  );
  const items = list.data?.items ?? [];
  const act = (action: () => Promise<string>) => {
    void run(async () => {
      setMessage(null);
      setMessage(await action());
      await queryClient.invalidateQueries({ queryKey: ["semester-results"] });
    });
  };
  const headers = () => ({ "idempotency-key": crypto.randomUUID() });
  const broadsheet = `/api/v1/reports/results?${new URLSearchParams({ ...scope, format: "csv" }).toString()}`;
  return (
    <div className="space-y-4">
      <h1 className="text-title">Semester results</h1>
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="block">
          <span className="block text-slate-700">Semester</span>
          <select
            value={semesterId}
            onChange={(e) => {
              setSemesterId(e.target.value);
              setMessage(null);
            }}
            className="rounded border border-slate-300 px-2 py-2"
          >
            <option value="">Choose…</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}, {sessionCode(s.academicSessionId)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-slate-700">Programme</span>
          <select
            value={programmeId}
            onChange={(e) => {
              setProgrammeId(e.target.value);
            }}
            className="rounded border border-slate-300 px-2 py-2"
          >
            <option value="">All programmes</option>
            {(programmes.data?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}
      {semesterId === "" ? null : (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <button
              type="button"
              disabled={busy}
              className="rounded border border-slate-300 px-3 py-2"
              onClick={() => {
                act(async () => {
                  const r = await api<typeof results.computeSemesterResults>(
                    "POST",
                    "/results/semesters/compute",
                    { body: scope, headers: headers() },
                  );
                  return `Computed ${String(r.computed)}; ${String(r.changed)} changed.`;
                });
              }}
            >
              Compute
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded border border-slate-300 px-3 py-2"
              onClick={() => {
                act(async () => {
                  const r = await api<typeof results.approveSemesterResults>(
                    "POST",
                    "/results/semesters/approve",
                    { body: scope, headers: headers() },
                  );
                  return `Approved ${String(r.approved)}${r.skipped > 0 ? `; ${String(r.skipped)} wait for a reopened course result` : ""}.`;
                });
              }}
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded bg-brand px-3 py-2 text-white disabled:opacity-60"
              onClick={() => {
                act(async () => {
                  const r = await api<typeof results.publishSemesterResults>(
                    "POST",
                    "/results/semesters/publish",
                    { body: scope, headers: headers() },
                  );
                  return `Published ${String(r.published)}. Students have been told.`;
                });
              }}
            >
              Publish
            </button>
            <a href={broadsheet} className="px-3 py-2 text-brand underline" download>
              Broadsheet (CSV)
            </a>
          </div>
          {list.isSuccess && items.length === 0 ? (
            <p className="text-sm text-slate-600">
              No semester results yet. Compute them once course results are finalized.
            </p>
          ) : null}
          <div
            role="region"
            aria-label="Semester results"
            tabIndex={0}
            className="overflow-x-auto rounded border border-slate-200 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-2">Student</th>
                  <th className="p-2">Credits</th>
                  <th className="p-2">GPA</th>
                  <th className="p-2">CGPA</th>
                  <th className="p-2">Standing</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <tr key={x.id} className="border-t border-slate-100">
                    <td className="p-2">
                      <div className="font-medium">{x.studentName}</div>
                      <div className="text-xs text-slate-500">
                        {x.matricNumber} · {x.programmeCode}
                      </div>
                    </td>
                    <td className="p-2">
                      {credits(x.creditsEarnedX10)}/{credits(x.creditsAttemptedX10)}
                    </td>
                    <td className="p-2">{hundredths(x.gpaX100)}</td>
                    <td className="p-2">{hundredths(x.cgpaX100)}</td>
                    <td className="p-2">{STANDING_LABELS[x.standing] || "–"}</td>
                    <td className="p-2">
                      {STATUS_LABELS[x.status]}
                      {x.draftCourseResults > 0 ? " (a course result is reopened)" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
