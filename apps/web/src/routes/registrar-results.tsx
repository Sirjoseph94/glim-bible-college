import type {
  assessment,
  CohortResultRow,
  CohortResults,
  cohorts,
  CourseResultRow,
  MakeupExam,
  offerings,
  results,
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
import { formText } from "../components/form";
import { CalendarDate } from "../components/time";
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
import { Select, TextField } from "../components/ui/field";
import { EmptyState } from "../components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { cn } from "../design/cn";
import { credits, hundredths } from "../design/format";

const KIND_LABELS: Record<CourseResultRow["resultKind"], string> = {
  GRADED: "",
  INCOMPLETE: "Incomplete",
  WITHDRAWN: "Withdrawn",
  EXEMPT: "Exempt",
  AUDIT: "Audit",
};

const resultsKey = (offeringId: string) => ["course-results", offeringId];

/** Whether the signed-in person holds one of these staff roles. */
function useHolds(...wanted: string[]): boolean {
  const me = useQuery(meQuery);
  return me.data?.roles.staff.some((r) => wanted.includes(r)) ?? false;
}

/** A course result's state as a word (UI-3). */
function resultStatus(item: CourseResultRow): { tone: Tone; word: string } {
  if (item.status === null && item.makeupOn !== null)
    return { tone: "info", word: `Incomplete — makeup exam on ${item.makeupOn}` };
  if (item.status === null) return { tone: "neutral", word: "Preview" };
  if (item.status === "APPROVED") return { tone: "success", word: "Approved" };
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
  const pending = r.items.length - r.finalized - r.awaitingMakeup;
  const refresh = () => queryClient.invalidateQueries({ queryKey: resultsKey(offeringId) });
  return (
    <div className="space-y-4">
      <PageHeader
        overline={
          offering.data ? `${offering.data.courseCode} · ${offering.data.cohortCode}` : undefined
        }
        title="Course results"
        meta={
          offering.data
            ? `${offering.data.title} · ${offering.data.startsOn} to ${offering.data.endsOn}`
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
        {r.awaitingMakeup > 0
          ? ` ${String(r.awaitingMakeup)} ${r.awaitingMakeup === 1 ? "student waits" : "students wait"} for a makeup exam; finalizing leaves them out until their exam is graded.`
          : ""}
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
      {offering.data ? (
        <MakeupExams
          offeringId={offeringId}
          examOn={offering.data.examOn}
          students={r.items.filter((i) => i.status === null || i.status === "DRAFT")}
          onChanged={refresh}
        />
      ) : null}
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
        The result goes back to draft until the course is finalized again, and the student's CGPA is
        provisional until it's approved again.
      </ConfirmDialog>
    </div>
  );
}

/**
 * Makeup exams (ADR-0005): a later exam date for a student who missed the exam, with a reason.
 * Finalizing leaves them out until their exam is graded; an online exam is open to them that day.
 */
function MakeupExams(props: {
  offeringId: string;
  examOn: string;
  /** Students whose result isn't finalized: only they can be given a makeup date. */
  students: CourseResultRow[];
  onChanged: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const key = ["makeup-exams", props.offeringId];
  const list = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api<typeof assessment.listMakeupExams>("GET", "/course-offerings/:id/makeup-exams", {
        params: { id: props.offeringId },
        signal,
      }),
  });
  const { busy, problem, fieldErrors, run } = useSubmit();
  const [removing, setRemoving] = useState<MakeupExam | null>(null);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: key });
    await props.onChanged();
  };
  return (
    <section className="space-y-3" aria-label="Makeup exams">
      <h2 className="text-heading">Makeup exams</h2>
      {list.data && list.data.items.length > 0 ? (
        <Card list role="list">
          {list.data.items.map((m) => (
            <div
              key={m.studentId}
              role="listitem"
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <p className="text-body-sm">
                {m.studentName} · <CalendarDate value={m.makeupOn} />
                <span className="block text-meta text-ink-muted">{m.reason}</span>
              </p>
              <Button
                size="sm"
                variant="quiet"
                aria-label={`Remove ${m.studentName}'s makeup exam`}
                onClick={() => {
                  setRemoving(m);
                }}
              >
                Remove
              </Button>
            </div>
          ))}
        </Card>
      ) : (
        <p className="text-body-sm text-ink-muted">Nobody has a makeup exam.</p>
      )}
      {props.students.length > 0 ? (
        <form
          className="grid gap-3 md:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const d = new FormData(form);
            void run(async () => {
              await api<typeof assessment.setMakeupExam>(
                "PUT",
                "/course-offerings/:id/makeup-exams/:studentId",
                {
                  params: { id: props.offeringId, studentId: formText(d, "studentId") },
                  body: { makeupOn: formText(d, "makeupOn"), reason: formText(d, "reason") },
                },
              );
              form.reset();
              await refresh();
            });
          }}
        >
          {problem ? (
            <div className="md:col-span-3">
              <Banner tone="danger" title={problem.title}>
                {problem.body}
              </Banner>
            </div>
          ) : null}
          <Select name="studentId" label="Student" required error={fieldErrors.studentId}>
            {props.students.map((st) => (
              <option key={st.studentId} value={st.studentId}>
                {st.studentName}
              </option>
            ))}
          </Select>
          <TextField
            name="makeupOn"
            type="date"
            label="Makeup exam on"
            min={props.examOn}
            required
            error={fieldErrors.makeupOn}
          />
          <TextField name="reason" label="Reason" required error={fieldErrors.reason} />
          <div className="md:col-span-3">
            <Button type="submit" variant="secondary" loading={busy}>
              Set makeup exam
            </Button>
          </div>
        </form>
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove ${removing?.studentName ?? ""}'s makeup exam?`}
        confirmLabel="Remove"
        tone="danger"
        onConfirm={async () => {
          if (removing === null) return;
          await api<typeof assessment.removeMakeupExam>(
            "DELETE",
            "/course-offerings/:id/makeup-exams/:studentId",
            { params: { id: props.offeringId, studentId: removing.studentId } },
          );
          setRemoving(null);
          await refresh();
        }}
      >
        Finalizing the course includes them again, with their exam grade as it stands.
      </ConfirmDialog>
    </section>
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
                    {o.cohortCode} · {o.startsOn} to {o.endsOn}
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

const STANDING_LABELS: Record<CohortResultRow["summary"]["standing"], string> = {
  GOOD: "Good standing",
  PROBATION: "Probation",
  WITHDRAW_REQUIRED: "Below good standing",
  UNKNOWN: "",
};

type CohortOffering = CohortResults["offerings"][number];

/** Where an offering's results stand, as a word (UI-3). */
function offeringState(o: CohortOffering): { tone: Tone; word: string } {
  if (o.enrolled === 0) return { tone: "neutral", word: "No students" };
  if (o.approved === o.enrolled) return { tone: "success", word: "Approved" };
  if (o.finalized > o.approved) return { tone: "warning", word: "Ready to approve" };
  if (o.finalized === 0) return { tone: "neutral", word: "Not finalized" };
  return { tone: "info", word: "Partly finalized" };
}

/**
 * The Registrar's cohort results (TRD §14.5, ADR-0005; handoff §11.10): each offering's results
 * from finalized to approved, with Approve per offering or for the whole cohort, the students'
 * results and CGPA, and transcript requests alongside (decision UI-Q8). A CGPA stays Provisional
 * until every result it counts is approved.
 */
export function CohortResultsPage() {
  const queryClient = useQueryClient();
  const canApprove = useHolds("REGISTRAR", "SYSTEM_ADMIN");
  const cohortList = useQuery({
    queryKey: ["cohorts"],
    queryFn: ({ signal }) => api<typeof cohorts.listCohorts>("GET", "/cohorts", { signal }),
  });
  const [chosen, setChosen] = useState("");
  const cohortId = chosen === "" ? (cohortList.data?.items[0]?.id ?? "") : chosen;
  const view = useQuery({
    queryKey: ["cohort-results", cohortId],
    enabled: cohortId !== "",
    queryFn: ({ signal }) =>
      api<typeof results.getCohortResults>("GET", "/results/cohorts/:id", {
        params: { id: cohortId },
        signal,
      }),
  });
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    { scope: "cohort" } | { scope: "offering"; offering: CohortOffering } | null
  >(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["cohort-results"] });
  const broadsheet = `/api/v1/reports/results?${new URLSearchParams({ cohortId, format: "csv" }).toString()}`;
  const data = view.data;
  const ready = data?.offerings.filter((o) => o.finalized > o.approved) ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        overline="Registrar"
        title="Cohort results"
        meta={
          data
            ? `${data.cohort.name} · best attempt counts`
            : "Choose a cohort to approve its results."
        }
        actions={
          cohortId === "" ? undefined : (
            <a href={broadsheet} download className={buttonClass({ variant: "secondary" })}>
              Broadsheet (CSV)
            </a>
          )
        }
      />
      <Select
        label="Cohort"
        value={cohortId}
        onChange={(e) => {
          setChosen(e.target.value);
          setMessage(null);
        }}
        hint={
          cohortList.isSuccess && cohortList.data.items.length === 0
            ? "A cohort appears once the first applicant of an intake accepts their offer."
            : undefined
        }
      >
        {(cohortList.data?.items ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} · {c.name}
          </option>
        ))}
      </Select>
      {message ? <Banner tone="success">{message}</Banner> : null}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {cohortId === "" ? null : view.isPending ? (
            <SkeletonGroup label="Loading the cohort's results">
              <Skeleton className="h-40" />
            </SkeletonGroup>
          ) : view.isError ? (
            <LoadFailed what="the cohort's results" onRetry={() => void view.refetch()} />
          ) : (
            <>
              {canApprove && ready.length > 0 ? (
                <Banner
                  tone="warning"
                  title={`${String(ready.length)} ${ready.length === 1 ? "course has" : "courses have"} results to approve`}
                >
                  Approving makes them official: transcripts and awards can include them, and
                  students' CGPA stops being provisional once all their results are approved.
                </Banner>
              ) : null}
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-heading">Courses</h2>
                  {canApprove && ready.length > 0 ? (
                    <Button
                      variant="primary"
                      onClick={() => {
                        setConfirm({ scope: "cohort" });
                      }}
                    >
                      Approve all
                    </Button>
                  ) : null}
                </div>
                {view.data.offerings.length === 0 ? (
                  <EmptyState icon="award" title="No courses scheduled yet">
                    Results appear here as each of the cohort's courses is finalized.
                  </EmptyState>
                ) : (
                  <DataTable caption="Courses" minWidth="min-w-160">
                    <thead>
                      <tr>
                        <th scope="col" className={cn(headCell, stickyCell, "bg-surface-sunken")}>
                          Course
                        </th>
                        <th scope="col" className={cn(headCell, numericCell)}>
                          Finalized
                        </th>
                        <th scope="col" className={cn(headCell, numericCell)}>
                          Approved
                        </th>
                        <th scope="col" className={headCell}>
                          Status
                        </th>
                        {canApprove ? (
                          <th scope="col" className={headCell}>
                            <span className="sr-only">Actions</span>
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {view.data.offerings.map((o) => {
                        const state = offeringState(o);
                        return (
                          <tr key={o.offeringId}>
                            <th
                              scope="row"
                              className={cn(bodyCell, stickyCell, "text-left font-normal")}
                            >
                              <Link
                                to="/course-results/$offeringId"
                                params={{ offeringId: o.offeringId }}
                                className="block text-subhead text-brand underline-offset-2 hover:underline"
                              >
                                <span className="font-mono">{o.courseCode}</span> {o.title}
                              </Link>
                              <span className="block text-meta text-ink-muted">
                                ended {o.endsOn}
                              </span>
                            </th>
                            <td className={cn(bodyCell, numericCell)}>
                              {o.finalized} of {o.enrolled}
                            </td>
                            <td className={cn(bodyCell, numericCell)}>
                              {o.approved} of {o.enrolled}
                            </td>
                            <td className={bodyCell}>
                              <Badge tone={state.tone}>{state.word}</Badge>
                            </td>
                            {canApprove ? (
                              <td className={bodyCell}>
                                {o.finalized > o.approved ? (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    aria-label={`Approve ${o.courseCode}`}
                                    onClick={() => {
                                      setConfirm({ scope: "offering", offering: o });
                                    }}
                                  >
                                    Approve
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
              </section>
              {view.data.items.length > 0 ? (
                <section className="space-y-3">
                  <h2 className="text-heading">Students</h2>
                  <DataTable caption="Students' results" minWidth="min-w-205">
                    <thead>
                      <tr>
                        <th scope="col" className={cn(headCell, stickyCell, "bg-surface-sunken")}>
                          Student
                        </th>
                        {view.data.offerings.map((o) => (
                          <th key={o.offeringId} scope="col" className={cn(headCell, "font-mono")}>
                            {o.courseCode}
                          </th>
                        ))}
                        <th scope="col" className={cn(headCell, numericCell)}>
                          Credits
                        </th>
                        <th scope="col" className={cn(headCell, numericCell)}>
                          CGPA
                        </th>
                        <th scope="col" className={headCell}>
                          Standing
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.data.items.map((x) => (
                        <tr key={x.programmeEnrollmentId}>
                          <th
                            scope="row"
                            className={cn(bodyCell, stickyCell, "text-left font-normal")}
                          >
                            <span className="block text-subhead">{x.studentName}</span>
                            <span className="block text-meta text-ink-muted">{x.matricNumber}</span>
                          </th>
                          {view.data.offerings.map((o) => {
                            const result = x.results[o.offeringId];
                            return (
                              <td key={o.offeringId} className={cn(bodyCell, "font-mono")}>
                                {result === undefined
                                  ? "–"
                                  : (result.letter ?? KIND_LABELS[result.resultKind])}
                              </td>
                            );
                          })}
                          <td className={cn(bodyCell, numericCell)}>
                            {credits(x.summary.creditsEarnedX10)}/
                            {credits(x.summary.creditsAttemptedX10)}
                          </td>
                          <td className={cn(bodyCell, numericCell)}>
                            {hundredths(x.summary.cgpaX100)}
                            {x.summary.provisional && x.summary.cgpaX100 !== null ? (
                              <span className="block text-meta text-ink-muted">Provisional</span>
                            ) : null}
                          </td>
                          <td className={bodyCell}>{STANDING_LABELS[x.summary.standing] || "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                </section>
              ) : null}
            </>
          )}
        </div>
        {canApprove ? <TranscriptRequests /> : null}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm?.scope === "offering"
            ? `Approve ${confirm.offering.courseCode}'s results?`
            : `Approve ${data?.cohort.code ?? "the cohort"}'s results?`
        }
        confirmLabel="Approve"
        onConfirm={async () => {
          if (confirm === null) return;
          const body =
            confirm.scope === "offering"
              ? { offeringId: confirm.offering.offeringId }
              : { cohortId };
          const r = await api<typeof results.approveResults>("POST", "/results/approve", {
            body,
            headers: { "idempotency-key": crypto.randomUUID() },
          });
          setConfirm(null);
          setMessage(
            [
              `Approved ${String(r.approved)} ${r.approved === 1 ? "result" : "results"}. Students have been told.`,
              r.skipped > 0 ? `${String(r.skipped)} reopened ones wait to be finalized again.` : "",
            ]
              .filter(Boolean)
              .join(" "),
          );
          await refresh();
        }}
      >
        Finalized results become official: transcripts and awards can include them. Reopened results
        are left until they're finalized again.
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
