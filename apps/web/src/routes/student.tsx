import type { enrollment, MyRegistration, offerings, SemesterRegistration } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { CourseCard } from "../components/app/course-card";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { CalendarDate } from "../components/time";
import { Badge, type Tone } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/dialog";
import { EmptyState } from "../components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { useSubmit } from "../components/use-submit";
import { credits } from "../design/format";

type CourseStatus =
  MyRegistration["programmes"][number]["semesters"][number]["courses"][number]["status"];
type Elective = SemesterRegistration["electives"][number];

const SELECTION: Record<string, string> = {
  COMPULSORY: "Compulsory",
  ELECTIVE: "Elective",
  MANUAL: "Registered by the college",
};

/** "3.0" (numeric(4,1)) as tenths of a credit, so totals stay exact (no floats). */
function creditTenths(text: string): number {
  const [whole = "0", fraction = ""] = text.split(".");
  return Number(whole) * 10 + Number((fraction + "0").slice(0, 1));
}

const COURSE_STATUS: Record<CourseStatus, { tone: Tone; word: string }> = {
  ENROLLED: { tone: "success", word: "Registered" },
  COMPLETED: { tone: "info", word: "Completed" },
  DROPPED: { tone: "neutral", word: "Dropped" },
  WITHDRAWN: { tone: "neutral", word: "Withdrawn" },
};

/** A student's registration: programme, Level and registered courses per semester (§9.3). */
export function RegistrationPage() {
  const mine = useQuery({
    queryKey: ["me", "registration"],
    queryFn: ({ signal }) =>
      api<typeof enrollment.getMyRegistration>("GET", "/me/registration", { signal }),
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="My registration"
        meta="Your programme and the courses you take each semester."
      />
      {mine.isPending ? (
        <SkeletonGroup label="Loading your registration">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-40" />
        </SkeletonGroup>
      ) : mine.isError ? (
        <LoadFailed what="your registration" onRetry={() => void mine.refetch()} />
      ) : mine.data.programmes.length === 0 ? (
        <EmptyState icon="book" title="No programme yet">
          Your registration appears here once you're admitted to a programme.
        </EmptyState>
      ) : (
        mine.data.programmes.map((p) => (
          <section key={p.matricNumber} className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-heading">{p.programme.name}</h2>
              <p className="text-body-sm text-ink-muted">
                Matric Number <span className="font-mono text-code">{p.matricNumber}</span> · Level{" "}
                {p.currentLevel} · {p.studyMode === "ON_CAMPUS" ? "On campus" : "Online"}
              </p>
            </div>
            {p.semesters.length === 0 ? (
              <EmptyState icon="calendar" title="Not open yet" headingLevel={3}>
                Registration hasn't opened yet. Your compulsory courses appear here as soon as it
                does.
              </EmptyState>
            ) : null}
            {p.semesters.map((s) => (
              <SemesterCard key={s.semester.id} semester={s} />
            ))}
          </section>
        ))
      )}
    </div>
  );
}

type SemesterView = MyRegistration["programmes"][number]["semesters"][number];

/** One semester: a credit summary, the registered courses, then the electives to choose. */
function SemesterCard({ semester: s }: { semester: SemesterView }) {
  const counted = s.courses.filter((c) => c.status === "ENROLLED" || c.status === "COMPLETED");
  const total = counted.reduce((sum, c) => sum + creditTenths(c.credits), 0);
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-subhead text-ink">
            {s.semester.name}, {s.semester.sessionName}
          </h3>
          <p className="text-meta text-ink-muted">
            <CalendarDate value={s.semester.startsOn} /> –{" "}
            <CalendarDate value={s.semester.endsOn} /> · Level {s.levelNo}
          </p>
        </div>
        <p className="rounded-md bg-surface-sunken px-3 py-2 text-label text-ink">
          {counted.length} {counted.length === 1 ? "course" : "courses"} · {credits(total)} credits
        </p>
      </div>
      {s.courses.length === 0 ? (
        <p className="text-body-sm text-ink-muted">No courses registered yet.</p>
      ) : (
        <ul className="divide-y divide-line" aria-label="Registered courses">
          {s.courses.map((c) => {
            const status = COURSE_STATUS[c.status];
            return (
              <li
                key={c.courseEnrollmentId}
                className="flex flex-wrap items-center gap-2 py-3 first:pt-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-body text-ink">
                    <span className="font-mono text-code text-brand">{c.courseCode}</span> {c.title}
                  </p>
                  <p className="text-meta text-ink-muted">
                    {c.credits} credits · {SELECTION[c.selection]}
                  </p>
                </div>
                <Badge tone={status.tone}>{status.word}</Badge>
              </li>
            );
          })}
        </ul>
      )}
      <Electives semesterEnrollmentId={s.semesterEnrollmentId} />
    </Card>
  );
}

/** A student's courses: the offerings they're registered for (via v_offering_access). */
/** The student's courses as cards, each opening the course page (§11.3, decision UI-Q5). */
export function CoursesPage() {
  const list = useQuery({
    queryKey: ["offerings", "mine"],
    queryFn: ({ signal }) =>
      api<typeof offerings.listOfferings>("GET", "/course-offerings", { signal }),
  });
  return (
    <div className="space-y-4">
      <h1 className="text-title">My courses</h1>
      {list.isPending ? (
        <SkeletonGroup label="Loading your courses">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        </SkeletonGroup>
      ) : list.isError ? (
        <Banner tone="danger">We couldn't load your courses.</Banner>
      ) : list.data.items.length === 0 ? (
        <EmptyState icon="book" title="No courses yet">
          Your courses appear here once you are registered for a semester.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {list.data.items.map((o) => (
            <CourseCard key={o.id} offering={o} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Electives for the semester: add or drop until the add/drop deadline (spec story 45). */
function Electives({ semesterEnrollmentId }: { semesterEnrollmentId: string }) {
  const queryClient = useQueryClient();
  const { busy, problem, run } = useSubmit();
  const [dropping, setDropping] = useState<Elective | null>(null);
  const key = ["registration", semesterEnrollmentId];
  const registration = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api<typeof enrollment.getSemesterRegistration>(
        "GET",
        "/semester-enrollments/:id/registration",
        {
          params: { id: semesterEnrollmentId },
          signal,
        },
      ),
  });
  const r = registration.data;
  if (r === undefined || r.electives.length === 0) return null;
  const update = async (next: SemesterRegistration) => {
    queryClient.setQueryData(key, next);
    await queryClient.invalidateQueries({ queryKey: ["me", "registration"] });
  };

  return (
    <section className="space-y-2 border-t border-line pt-4">
      <h4 className="text-subhead text-ink">Electives</h4>
      <p className="text-body-sm text-ink-muted">
        {r.windowOpen ? (
          r.semester.addDropDeadlineOn === null ? (
            "Add or drop electives while registration is open. Adding one registers you for it straight away."
          ) : (
            <>
              Add or drop electives until <CalendarDate value={r.semester.addDropDeadlineOn} />.
              Adding one registers you for it straight away.
            </>
          )
        ) : (
          "Electives can no longer be changed; ask the Academic Admin."
        )}
      </p>
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      <ul className="divide-y divide-line" aria-label="Electives">
        {r.electives.map((e) => (
          <li key={e.offeringId} className="flex flex-wrap items-center gap-2 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-body text-ink">
                <span className="font-mono text-code text-brand">{e.courseCode}</span> {e.title}
              </p>
              <p className="text-meta text-ink-muted">
                {e.credits} credits
                {e.capacity === null
                  ? null
                  : ` · ${String(Math.max(0, e.capacity - e.enrolled))} places left`}
              </p>
            </div>
            {e.courseEnrollmentId !== null ? (
              <Badge tone="success">Registered</Badge>
            ) : e.full ? (
              <Badge tone="neutral">Full</Badge>
            ) : null}
            {!r.windowOpen ? null : e.courseEnrollmentId !== null ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDropping(e);
                }}
              >
                Drop {e.courseCode}
              </Button>
            ) : e.full ? null : (
              <Button
                variant="primary"
                size="sm"
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    await update(
                      await api<typeof enrollment.addElective>(
                        "POST",
                        "/semester-enrollments/:id/electives",
                        {
                          params: { id: semesterEnrollmentId },
                          body: { offeringId: e.offeringId },
                        },
                      ),
                    );
                  })
                }
              >
                Add {e.courseCode}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={dropping !== null}
        onOpenChange={(open) => {
          if (!open) setDropping(null);
        }}
        title={`Drop ${dropping?.courseCode ?? ""}?`}
        confirmLabel="Drop elective"
        tone="danger"
        onConfirm={async () => {
          const courseEnrollmentId = dropping?.courseEnrollmentId;
          if (courseEnrollmentId == null) return;
          await update(
            await api<typeof enrollment.dropElective>(
              "DELETE",
              "/semester-enrollments/:id/electives/:courseEnrollmentId",
              { params: { id: semesterEnrollmentId, courseEnrollmentId } },
            ),
          );
          setDropping(null);
        }}
      >
        You leave {dropping?.title ?? "the course"} and give up your place. You can add it again
        while electives are open, if a place is still free.
      </ConfirmDialog>
    </section>
  );
}
