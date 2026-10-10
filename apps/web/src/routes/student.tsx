import type { enrollment, offerings, SemesterRegistration } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { CourseCard } from "../components/app/course-card";
import { Alert } from "../components/form";
import { CalendarDate } from "../components/time";
import { Banner } from "../components/ui/banner";
import { EmptyState } from "../components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { useSubmit } from "../components/use-submit";

const SELECTION: Record<string, string> = {
  COMPULSORY: "Compulsory",
  ELECTIVE: "Elective",
  MANUAL: "Registered by the college",
};

/** A student's registration: programme, Level and registered courses per semester (§9.3). */
export function RegistrationPage() {
  const mine = useQuery({
    queryKey: ["me", "registration"],
    queryFn: ({ signal }) =>
      api<typeof enrollment.getMyRegistration>("GET", "/me/registration", { signal }),
  });
  if (mine.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (mine.isError) return <Alert tone="error">We couldn't load your registration.</Alert>;

  return (
    <div className="space-y-6">
      <h1 className="text-title">My registration</h1>
      {mine.data.programmes.map((p) => (
        <section key={p.matricNumber} className="space-y-3">
          <div>
            <h3 className="text-lg font-semibold">{p.programme.name}</h3>
            <p className="text-sm text-slate-600">
              Matric Number {p.matricNumber} · Level {p.currentLevel} ·{" "}
              {p.studyMode === "ON_CAMPUS" ? "On campus" : "Online"}
            </p>
          </div>
          {p.semesters.length === 0 ? (
            <p className="text-slate-600">
              Registration hasn't opened yet. Your compulsory courses appear here as soon as it
              does.
            </p>
          ) : null}
          {p.semesters.map((s) => (
            <div key={s.semester.id} className="rounded border border-slate-200 bg-white p-3">
              <h4 className="font-medium">
                {s.semester.name}, {s.semester.sessionName}
              </h4>
              <p className="mb-2 text-sm text-slate-600">
                <CalendarDate value={s.semester.startsOn} /> –{" "}
                <CalendarDate value={s.semester.endsOn} /> · Level {s.levelNo}
              </p>
              <Electives semesterEnrollmentId={s.semesterEnrollmentId} />
              {s.courses.length === 0 ? (
                <p className="text-sm text-slate-600">No courses registered yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {s.courses.map((c) => (
                    <li
                      key={c.courseEnrollmentId}
                      className="flex flex-wrap justify-between gap-2 py-1"
                    >
                      <span>
                        <strong>{c.courseCode}</strong> {c.title}
                      </span>
                      <span className="text-slate-600">
                        {c.credits} credits · {SELECTION[c.selection]} · {c.status.toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
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
  const { busy, error, run } = useSubmit();
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
    <div className="mb-3 space-y-2 rounded bg-slate-50 p-2">
      <p className="text-sm">
        <strong>Electives</strong>{" "}
        {r.windowOpen ? (
          r.semester.addDropDeadlineOn === null ? (
            "can be added or dropped while registration is open."
          ) : (
            <>
              can be added or dropped until <CalendarDate value={r.semester.addDropDeadlineOn} />.
            </>
          )
        ) : (
          "can no longer be changed; ask the Academic Admin."
        )}
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="space-y-1 text-sm">
        {r.electives.map((e) => (
          <li key={e.offeringId} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>{e.courseCode}</strong> {e.title} · {e.credits} credits
              {e.capacity === null
                ? null
                : ` · ${String(Math.max(0, e.capacity - e.enrolled))} places left`}
            </span>
            {!r.windowOpen ? null : e.courseEnrollmentId !== null ? (
              <button
                type="button"
                disabled={busy}
                className="underline"
                onClick={() =>
                  void run(async () => {
                    await update(
                      await api<typeof enrollment.dropElective>(
                        "DELETE",
                        "/semester-enrollments/:id/electives/:courseEnrollmentId",
                        {
                          params: {
                            id: semesterEnrollmentId,
                            courseEnrollmentId: e.courseEnrollmentId ?? "",
                          },
                        },
                      ),
                    );
                  })
                }
              >
                Drop {e.courseCode}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || e.full}
                className="rounded bg-brand px-2 py-1 text-white disabled:opacity-50"
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
                {e.full ? "Full" : `Add ${e.courseCode}`}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
