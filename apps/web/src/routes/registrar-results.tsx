import type {
  academic,
  calendar,
  CourseResultRow,
  offerings,
  results,
  SemesterResultRow,
  TranscriptRequest,
  transcripts,
} from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api/client";
import { describeError, type ErrorCopy } from "../api/error-copy";
import { meQuery } from "../api/session";
import { PageHeader } from "../components/app/page-header";
import { isNotAvailable, LoadFailed, NotAvailable } from "../components/app/page-states";
import { useDetailBar } from "../components/app/shell-parts";
import { useSubmit } from "../components/use-submit";
import { Badge, type Tone } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button, buttonClass } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  bodyCell,
  DataTable,
  headCell,
  numericCell,
  stickyCell,
} from "../components/ui/data-table";
import { ConfirmDialog } from "../components/ui/dialog";
import { Select } from "../components/ui/field";
import { EmptyState } from "../components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { cohortLabel, cohortState, summarize, type CohortSummary } from "../components/app/cohorts";
import { cn } from "../design/cn";
import { credits, hundredths } from "../design/format";

const KIND_LABELS: Record<CourseResultRow["resultKind"], string> = {
  GRADED: "",
  INCOMPLETE: "Incomplete",
  WITHDRAWN: "Withdrawn",
  EXEMPT: "Exempt",
  AUDIT: "Audit",
};

const STANDING_LABELS: Record<SemesterResultRow["standing"], string> = {
  GOOD: "Good standing",
  PROBATION: "Probation",
  WITHDRAW_REQUIRED: "Below good standing",
  UNKNOWN: "",
};

const resultsKey = (offeringId: string) => ["course-results", offeringId];

/** Whether the signed-in person holds one of these staff roles. */
function useHolds(...wanted: string[]): boolean {
  const me = useQuery(meQuery);
  return me.data?.roles.staff.some((r) => wanted.includes(r)) ?? false;
}

/** A course result's state as a word (UI-3). */
function resultStatus(item: CourseResultRow): { tone: Tone; word: string } {
  if (item.status === null) return { tone: "neutral", word: "Preview" };
  if (item.status === "DRAFT") return { tone: "warning", word: "Reopened" };
  return {
    tone: "success",
    word:
      item.reopenedCount > 0 ? `Finalized (reopened ${String(item.reopenedCount)}×)` : "Finalized",
  };
}

/**
 * A course's results (TRD §14.3; handoff §11.9 "Finalize results", composed): a preview of what
 * finalizing records, then the frozen results. The PRIMARY Lecturer (or an Academic Admin)
 * finalizes; the Registrar can reopen one result, with a reason.
 */
export function CourseResultsPage() {
  const { offeringId } = useParams({ from: "/course-results/$offeringId" });
  const queryClient = useQueryClient();
  const isRegistrar = useHolds("REGISTRAR", "SYSTEM_ADMIN");
  // Results staff (the Academic Admin too) come from the course list; Lecturers from the gradebook.
  const fromCourseList = useHolds("REGISTRAR", "SYSTEM_ADMIN", "ACADEMIC_ADMIN");
  const offering = useQuery({
    queryKey: ["offering", offeringId],
    queryFn: ({ signal }) =>
      api<typeof offerings.getOffering>("GET", "/course-offerings/:id", {
        params: { id: offeringId },
        signal,
      }),
  });
  const list = useQuery({
    queryKey: resultsKey(offeringId),
    queryFn: ({ signal }) =>
      api<typeof results.listCourseResults>("GET", "/course-offerings/:id/results", {
        params: { id: offeringId },
        signal,
      }),
  });
  // Back to where the person came from: the Registrar's course list, or the Lecturer's gradebook.
  useDetailBar(
    fromCourseList
      ? { back: { to: "/results/courses", label: "Course results" } }
      : {
          back: {
            to: "/teach/$offeringId",
            params: { offeringId },
            search: { tab: "gradebook" },
            label: "Gradebook",
          },
          ...(offering.data ? { code: offering.data.courseCode } : {}),
        },
  );
  const [confirming, setConfirming] = useState(false);
  const [reopening, setReopening] = useState<CourseResultRow | null>(null);

  if (list.isPending)
    return (
      <SkeletonGroup label="Loading the results">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-60" />
      </SkeletonGroup>
    );
  if (list.isError)
    return isNotAvailable(list.error) ? (
      <NotAvailable />
    ) : (
      <LoadFailed what="the results" onRetry={() => void list.refetch()} />
    );
  const r = list.data;
  const pending = r.items.length - r.finalized;
  const refresh = () => queryClient.invalidateQueries({ queryKey: resultsKey(offeringId) });
  return (
    <div className="space-y-4">
      <PageHeader
        overline={
          offering.data ? `${offering.data.courseCode} · ${offering.data.sectionCode}` : undefined
        }
        title="Course results"
        meta={
          offering.data
            ? `${offering.data.title} · ${offering.data.semesterName}, ${offering.data.sessionCode}`
            : undefined
        }
        actions={
          pending > 0 && r.blocker === null ? (
            <Button
              variant="primary"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Finalize results
            </Button>
          ) : undefined
        }
      />
      <p className="text-body-sm text-ink">
        {r.finalized === 0
          ? "Nothing is finalized yet: this is what finalizing would record, from the gradebook as it is now."
          : `${String(r.finalized)} of ${String(r.items.length)} results finalized. Students see them straight away.`}
      </p>
      {r.blocker !== null ? (
        <Banner tone="warning" title="Finalizing can't run yet">
          {r.blocker}
        </Banner>
      ) : null}
      {r.items.length === 0 ? (
        <EmptyState icon="users" title="No students">
          Nobody is enrolled on this course.
        </EmptyState>
      ) : (
        <DataTable caption="Course results" minWidth="min-w-160">
          <thead>
            <tr>
              <th scope="col" className={cn(headCell, stickyCell, "bg-surface-sunken")}>
                Student
              </th>
              <th scope="col" className={cn(headCell, numericCell)}>
                Final
              </th>
              <th scope="col" className={headCell}>
                Grade
              </th>
              <th scope="col" className={cn(headCell, numericCell)}>
                Credits
              </th>
              <th scope="col" className={headCell}>
                Status
              </th>
              {isRegistrar ? (
                <th scope="col" className={headCell}>
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {r.items.map((item) => {
              const status = resultStatus(item);
              const final = item.status !== null && item.status !== "DRAFT";
              return (
                <tr key={item.courseEnrollmentId}>
                  <th scope="row" className={cn(bodyCell, stickyCell, "text-left font-normal")}>
                    <span className="block text-subhead">{item.studentName}</span>
                    <span className="block text-meta text-ink-muted">
                      {[
                        item.matricNumber,
                        item.attemptNo > 1 ? `attempt ${String(item.attemptNo)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </th>
                  <td className={cn(bodyCell, numericCell)}>{hundredths(item.finalPctX100)}%</td>
                  <td className={cn(bodyCell, "font-mono font-semibold")}>
                    {item.letter ?? "—"}
                    {KIND_LABELS[item.resultKind] === "" ? null : (
                      <span className="ml-2 font-sans font-normal text-ink-muted">
                        {KIND_LABELS[item.resultKind]}
                      </span>
                    )}
                  </td>
                  <td className={cn(bodyCell, numericCell)}>{credits(item.creditsX10)}</td>
                  <td className={bodyCell}>
                    <Badge tone={status.tone}>{status.word}</Badge>
                  </td>
                  {isRegistrar ? (
                    <td className={bodyCell}>
                      {final && item.id !== null ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={`Reopen ${item.studentName}'s result`}
                          onClick={() => {
                            setReopening(item);
                          }}
                        >
                          Reopen
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Finalize ${String(pending)} result${pending === 1 ? "" : "s"}?`}
        confirmLabel="Finalize now"
        onConfirm={async () => {
          await api<typeof results.finalizeCourseResults>(
            "POST",
            "/course-offerings/:id/results/finalize",
            { params: { id: offeringId }, headers: { "idempotency-key": crypto.randomUUID() } },
          );
          setConfirming(false);
          await refresh();
        }}
      >
        Students see their course result straight away. Their grades lock: after this only the
        Registrar can reopen a result.
      </ConfirmDialog>
      <ConfirmDialog
        open={reopening !== null}
        onOpenChange={(open) => {
          if (!open) setReopening(null);
        }}
        title={`Reopen ${reopening?.studentName ?? ""}'s result?`}
        confirmLabel="Reopen result"
        tone="danger"
        reason={{ label: "Reason", minLength: 1 }}
        onConfirm={async (reason) => {
          const id = reopening?.id;
          if (id == null) return;
          await api<typeof results.reopenCourseResult>("POST", "/course-results/:id/reopen", {
            params: { id },
            body: { reason },
          });
          setReopening(null);
          await refresh();
        }}
      >
        The result goes back to draft until the course is finalized again, and the student's
        semester result waits for it.
      </ConfirmDialog>
    </div>
  );
}

/** The Registrar's way in: every Course Offering, each opening its results. */
export function ResultsCoursesPage() {
  const list = useQuery({
    queryKey: ["offerings", "all"],
    queryFn: ({ signal }) =>
      api<typeof offerings.listOfferings>("GET", "/course-offerings", { query: {}, signal }),
  });
  return (
    <div className="space-y-4">
      <PageHeader overline="Registrar" title="Course results" meta="Every Course Offering." />
      {list.isPending ? (
        <SkeletonGroup label="Loading the courses">
          <Skeleton className="h-40" />
        </SkeletonGroup>
      ) : list.isError ? (
        <LoadFailed what="the courses" onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon="book" title="No Course Offerings yet" />
      ) : (
        <Card list role="list">
          {list.data.items.map((o) => (
            <div key={o.id} role="listitem">
              <Link
                to="/course-results/$offeringId"
                params={{ offeringId: o.id }}
                className="flex min-h-tap items-center gap-3 px-4 py-3 hover:bg-surface-sunken"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-subhead text-ink">
                    <span className="font-mono text-code text-brand">{o.courseCode}</span> {o.title}
                  </span>
                  <span className="block text-meta text-ink-muted">
                    {o.semesterName}, {o.sessionCode} · section {o.sectionCode}
                  </span>
                </span>
              </Link>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

interface Cohort {
  /** Null until the programme list has loaded: no action can be scoped to it yet. */
  programmeId: string | null;
  code: string;
  /** Its Course Offerings this semester and how many are finalized. */
  courses: { offerings: number; offeringsFinalized: number } | undefined;
  rows: SemesterResultRow[];
  summary: CohortSummary;
}

const STUDENT_STATUS: Record<SemesterResultRow["status"], { tone: Tone; word: string }> = {
  DRAFT: { tone: "warning", word: "Provisional" },
  APPROVED: { tone: "info", word: "Approved, not published" },
  PUBLISHED: { tone: "success", word: "Published" },
};

const students = (n: number) => `${String(n)} ${n === 1 ? "student's" : "students'"}`;

/** What confirming does, and to whom (§10.5): only the students it changes are counted. */
function confirmText(s: CohortSummary, action: "approve" | "publish"): string {
  const waiting =
    s.blocked > 0 ? ` ${String(s.blocked)} with a reopened course result stay provisional.` : "";
  return action === "approve"
    ? `${students(s.ready + s.approved)} GPA and CGPA become official and they are told; official transcripts can include this semester.${waiting}`
    : `${students(s.approved)} approved results are published and they are told.${waiting}`;
}

/**
 * The Registrar's semester results (TRD §14.5; handoff §11.10): each cohort's state with its next
 * step ("Approve and publish"), the students' results, and transcript requests alongside
 * (decision UI-Q8). Compute runs first, from finalized course results. (The handoff's "Courses
 * finalized 8 of 8" waits on the API: .scratch/ui-overhaul/issues/02.)
 */
export function SemesterResultsPage() {
  const queryClient = useQueryClient();
  const canTranscripts = useHolds("REGISTRAR", "SYSTEM_ADMIN");
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
  const list = useQuery({
    queryKey: ["semester-results", semesterId],
    enabled: semesterId !== "",
    queryFn: ({ signal }) =>
      api<typeof results.listSemesterResults>("GET", "/results/semesters", {
        query: { semesterId },
        signal,
      }),
  });
  const { busy, problem, run } = useSubmit();
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ cohort: Cohort; action: "approve" | "publish" } | null>(
    null,
  );
  const sessionCode = (id: string) => sessions.data?.items.find((x) => x.id === id)?.code ?? "";
  const options = [...(semesters.data?.items ?? [])].sort((a, b) =>
    b.startsOn.localeCompare(a.startsOn),
  );
  const semester = options.find((s) => s.id === semesterId);
  const all = list.data?.items ?? [];
  const programmeIdOf = (code: string) => programmes.data?.items.find((p) => p.code === code)?.id;
  // The programme filter applies to everything on the page: cohorts, students, Compute, CSV.
  const shown =
    programmeId === "" ? all : all.filter((r) => programmeIdOf(r.programmeCode) === programmeId);
  const cohorts: Cohort[] = [...new Set(shown.map((r) => r.programmeCode))].sort().map((code) => {
    const rows = shown.filter((r) => r.programmeCode === code);
    return {
      code,
      programmeId: programmeIdOf(code) ?? null,
      courses: list.data?.courses.find((x) => x.programmeCode === code),
      rows,
      summary: summarize(rows),
    };
  });
  const ready = cohorts.filter((c) => cohortState(c.summary).next === "approve").length;
  const scope = { semesterId, ...(programmeId === "" ? {} : { programmeId }) };
  const headers = () => ({ "idempotency-key": crypto.randomUUID() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["semester-results"] });
  const broadsheet = `/api/v1/reports/results?${new URLSearchParams({ semesterId, ...(programmeId === "" ? {} : { programmeId }), format: "csv" }).toString()}`;

  const compute = () => {
    void run(async () => {
      setMessage(null);
      const r = await api<typeof results.computeSemesterResults>(
        "POST",
        "/results/semesters/compute",
        { body: scope, headers: headers() },
      );
      setMessage(`Computed ${String(r.computed)}; ${String(r.changed)} changed.`);
      await refresh();
    });
  };
  return (
    <div className="space-y-5">
      <PageHeader
        overline="Registrar"
        title="Semester results"
        meta={
          semester
            ? `${sessionCode(semester.academicSessionId)} · ${semester.name} · best attempt counts`
            : "Choose a semester to compute, approve and publish its results."
        }
        actions={
          semesterId === "" ? undefined : (
            <a href={broadsheet} download className={buttonClass({ variant: "secondary" })}>
              Broadsheet (CSV)
            </a>
          )
        }
      />
      <div className="grid gap-3 md:grid-cols-2">
        <Select
          label="Semester"
          value={semesterId}
          onChange={(e) => {
            setSemesterId(e.target.value);
            setMessage(null);
          }}
        >
          <option value="">Choose…</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}, {sessionCode(s.academicSessionId)}
            </option>
          ))}
        </Select>
        <Select
          label="Programme"
          value={programmeId}
          onChange={(e) => {
            setProgrammeId(e.target.value);
          }}
        >
          <option value="">All programmes</option>
          {(programmes.data?.items ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.code}
            </option>
          ))}
        </Select>
      </div>
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      {message ? <Banner tone="success">{message}</Banner> : null}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {semesterId === "" ? null : list.isPending ? (
            <SkeletonGroup label="Loading semester results">
              <Skeleton className="h-40" />
            </SkeletonGroup>
          ) : list.isError ? (
            <LoadFailed what="the semester results" onRetry={() => void list.refetch()} />
          ) : (
            <>
              {ready > 0 ? (
                <Banner
                  tone="warning"
                  title={`${String(ready)} ${ready === 1 ? "cohort is" : "cohorts are"} ready to approve`}
                >
                  Approving makes students' GPA and CGPA official, and official transcripts can
                  include this semester.
                </Banner>
              ) : null}
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-heading">Cohorts</h2>
                  <Button variant="secondary" loading={busy} onClick={compute}>
                    Compute
                  </Button>
                </div>
                {cohorts.length === 0 ? (
                  <EmptyState icon="award" title="No semester results yet">
                    Compute them once course results are finalized.
                  </EmptyState>
                ) : (
                  <DataTable caption="Cohorts" minWidth="min-w-160">
                    <thead>
                      <tr>
                        <th scope="col" className={cn(headCell, stickyCell, "bg-surface-sunken")}>
                          Programme
                        </th>
                        <th scope="col" className={cn(headCell, numericCell)}>
                          Students
                        </th>
                        <th scope="col" className={cn(headCell, numericCell)}>
                          Courses finalized
                        </th>
                        <th scope="col" className={headCell}>
                          Status
                        </th>
                        <th scope="col" className={headCell}>
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {cohorts.map((c) => {
                        const state = cohortState(c.summary);
                        return (
                          <tr key={c.code}>
                            <th
                              scope="row"
                              className={cn(
                                bodyCell,
                                stickyCell,
                                "text-left font-mono font-semibold",
                              )}
                            >
                              {cohortLabel(c.code, c.summary.levels)}
                            </th>
                            <td className={cn(bodyCell, numericCell)}>{c.summary.total}</td>
                            <td className={cn(bodyCell, numericCell)}>
                              {c.courses === undefined
                                ? "–"
                                : `${String(c.courses.offeringsFinalized)} of ${String(c.courses.offerings)}`}
                            </td>
                            <td className={bodyCell}>
                              <Badge tone={state.tone}>{state.word}</Badge>
                              {state.note ? (
                                <span className="block pt-1 text-meta text-ink-muted">
                                  {state.note}
                                </span>
                              ) : null}
                            </td>
                            <td className={bodyCell}>
                              {state.next !== null && c.programmeId !== null ? (
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() => {
                                    if (state.next !== null)
                                      setConfirm({ cohort: c, action: state.next });
                                  }}
                                >
                                  {state.next === "approve" ? "Approve and publish" : "Publish"}
                                </Button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </DataTable>
                )}
              </section>
              {shown.length > 0 ? (
                <section className="space-y-3">
                  <h2 className="text-heading">Students</h2>
                  <DataTable caption="Semester results" minWidth="min-w-205">
                    <thead>
                      <tr>
                        <th scope="col" className={cn(headCell, stickyCell, "bg-surface-sunken")}>
                          Student
                        </th>
                        <th scope="col" className={cn(headCell, numericCell)}>
                          Credits
                        </th>
                        <th scope="col" className={cn(headCell, numericCell)}>
                          GPA
                        </th>
                        <th scope="col" className={cn(headCell, numericCell)}>
                          CGPA
                        </th>
                        <th scope="col" className={headCell}>
                          Standing
                        </th>
                        <th scope="col" className={headCell}>
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((x) => (
                        <tr key={x.id}>
                          <th
                            scope="row"
                            className={cn(bodyCell, stickyCell, "text-left font-normal")}
                          >
                            <span className="block text-subhead">{x.studentName}</span>
                            <span className="block text-meta text-ink-muted">
                              {x.matricNumber} · {x.programmeCode}
                            </span>
                          </th>
                          <td className={cn(bodyCell, numericCell)}>
                            {credits(x.creditsEarnedX10)}/{credits(x.creditsAttemptedX10)}
                          </td>
                          <td className={cn(bodyCell, numericCell)}>{hundredths(x.gpaX100)}</td>
                          <td className={cn(bodyCell, numericCell)}>{hundredths(x.cgpaX100)}</td>
                          <td className={bodyCell}>{STANDING_LABELS[x.standing] || "–"}</td>
                          <td className={bodyCell}>
                            <Badge tone={STUDENT_STATUS[x.status].tone}>
                              {STUDENT_STATUS[x.status].word}
                            </Badge>
                            {x.draftCourseResults > 0 ? (
                              <span className="ml-2 text-meta text-ink-muted">
                                a course result is reopened
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                </section>
              ) : null}
            </>
          )}
        </div>
        {canTranscripts ? <TranscriptRequests /> : null}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm?.action === "publish"
            ? `Publish ${confirm.cohort.code}?`
            : `Approve ${confirm?.cohort.code ?? ""}?`
        }
        confirmLabel={confirm?.action === "publish" ? "Publish" : "Approve and publish"}
        onConfirm={async () => {
          if (confirm === null || confirm.cohort.programmeId === null) return;
          const body = { semesterId, programmeId: confirm.cohort.programmeId };
          const approved =
            confirm.action === "approve"
              ? await api<typeof results.approveSemesterResults>(
                  "POST",
                  "/results/semesters/approve",
                  { body, headers: headers() },
                )
              : null;
          const published = await api<typeof results.publishSemesterResults>(
            "POST",
            "/results/semesters/publish",
            { body, headers: headers() },
          );
          setConfirm(null);
          setMessage(
            [
              approved ? `Approved ${String(approved.approved)} and published` : "Published",
              `${String(published.published)}. Students have been told.`,
              approved && approved.skipped > 0
                ? `${String(approved.skipped)} wait for a reopened course result.`
                : "",
            ]
              .filter(Boolean)
              .join(" "),
          );
          await refresh();
        }}
      >
        {confirm ? confirmText(confirm.cohort.summary, confirm.action) : ""}
      </ConfirmDialog>
    </div>
  );
}

const REQUEST_STATUS: Record<TranscriptRequest["status"], { tone: Tone; word: string }> = {
  REQUESTED: { tone: "warning", word: "Waiting" },
  APPROVED: { tone: "brand", word: "Approved" },
  REJECTED: { tone: "neutral", word: "Declined" },
  ISSUED: { tone: "success", word: "Issued" },
  CANCELLED: { tone: "neutral", word: "Cancelled" },
};

/**
 * Transcript requests beside the semester results (§11.10, decision UI-Q8): approve or decline
 * official ones, then issue. Issued transcripts open for the PDF and revoking.
 */
function TranscriptRequests() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<TranscriptRequest["status"] | "">("REQUESTED");
  const list = useQuery({
    queryKey: ["transcript-requests", status],
    queryFn: ({ signal }) =>
      api<typeof transcripts.listTranscriptRequests>("GET", "/transcript-requests", {
        query: status === "" ? {} : { status },
        signal,
      }),
  });
  const [problem, setProblem] = useState<ErrorCopy | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<TranscriptRequest | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["transcript-requests"] });
  const act = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id);
    setProblem(null);
    try {
      await action();
      await refresh();
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section aria-label="Transcript requests" className="space-y-3">
      <h2 className="text-heading">Transcript requests</h2>
      <Select
        label="Show"
        value={status}
        onChange={(e) => {
          setStatus(e.target.value as TranscriptRequest["status"] | "");
        }}
      >
        <option value="REQUESTED">Waiting</option>
        <option value="APPROVED">Approved</option>
        <option value="ISSUED">Issued</option>
        <option value="REJECTED">Declined</option>
        <option value="">All</option>
      </Select>
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      {list.isPending ? (
        <SkeletonGroup label="Loading transcript requests">
          <Skeleton className="h-24" />
        </SkeletonGroup>
      ) : list.isError ? (
        <LoadFailed what="the transcript requests" onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon="file" title="Nothing here" headingLevel={3}>
          No transcript requests with this status.
        </EmptyState>
      ) : (
        <Card list role="list">
          {list.data.items.map((r) => (
            <div
              key={r.id}
              role="listitem"
              aria-label={r.studentName}
              className="space-y-2 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-subhead">{r.studentName}</p>
                  <p className="text-meta text-ink-muted">
                    {r.matricNumber} · {r.kind === "OFFICIAL" ? "Official" : "Unofficial"}
                  </p>
                </div>
                <Badge tone={REQUEST_STATUS[r.status].tone}>{REQUEST_STATUS[r.status].word}</Badge>
              </div>
              {r.purpose === null ? null : (
                <p className="text-body-sm">
                  {r.purpose} · for {r.recipientName} ({r.recipientEmail})
                </p>
              )}
              {r.transcript === null ? null : (
                <p className="font-mono text-code text-ink-muted">
                  {r.status === "ISSUED" ? "Issued · " : ""}
                  {r.transcript.serialNo} · verify {r.transcript.verificationCode}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {r.status === "REQUESTED" ? (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busy === r.id}
                    onClick={() =>
                      void act(r.id, () =>
                        api<typeof transcripts.approveTranscriptRequest>(
                          "POST",
                          "/transcript-requests/:id/approve",
                          { params: { id: r.id } },
                        ),
                      )
                    }
                  >
                    Approve
                  </Button>
                ) : null}
                {r.status === "APPROVED" ? (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busy === r.id}
                    onClick={() =>
                      void act(r.id, () =>
                        api<typeof transcripts.issueTranscript>(
                          "POST",
                          "/transcript-requests/:id/issue",
                          {
                            params: { id: r.id },
                            headers: { "idempotency-key": crypto.randomUUID() },
                          },
                        ),
                      )
                    }
                  >
                    Issue
                  </Button>
                ) : null}
                {r.status === "REQUESTED" || r.status === "APPROVED" ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setDeclining(r);
                    }}
                  >
                    Decline
                  </Button>
                ) : null}
                {r.status === "ISSUED" && r.transcript !== null ? (
                  <a
                    href={`/api/v1/transcripts/${r.transcript.id}/download`}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    PDF
                  </a>
                ) : null}
                {r.transcript === null ? null : (
                  <Link
                    to="/transcripts/$transcriptId"
                    params={{ transcriptId: r.transcript.id }}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    View
                  </Link>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
      <ConfirmDialog
        open={declining !== null}
        onOpenChange={(open) => {
          if (!open) setDeclining(null);
        }}
        title={`Decline ${declining?.studentName ?? ""}'s request?`}
        confirmLabel="Decline request"
        tone="danger"
        reason={{ label: "Reason (the student sees it)", minLength: 1 }}
        onConfirm={async (reason) => {
          const r = declining;
          if (r === null) return;
          await api<typeof transcripts.rejectTranscriptRequest>(
            "POST",
            "/transcript-requests/:id/reject",
            { params: { id: r.id }, body: { reason } },
          );
          setDeclining(null);
          await refresh();
        }}
      >
        The student is told, with your reason.
      </ConfirmDialog>
    </section>
  );
}
