import type { enrollment, offerings } from "@glim/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { Alert } from "../components/form";
import { CalendarDate } from "../components/time";

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
      <h2 className="text-xl font-semibold">My registration</h2>
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
export function CoursesPage() {
  const list = useQuery({
    queryKey: ["offerings", "mine"],
    queryFn: ({ signal }) =>
      api<typeof offerings.listOfferings>("GET", "/course-offerings", { signal }),
  });
  if (list.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (list.isError) return <Alert tone="error">We couldn't load your courses.</Alert>;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">My courses</h2>
      {list.data.items.length === 0 ? (
        <p className="text-slate-600">You aren't registered for any courses yet.</p>
      ) : null}
      <ul className="space-y-2">
        {list.data.items.map((o) => (
          <li key={o.id} className="rounded border border-slate-200 bg-white p-3">
            <div className="font-medium">
              {o.courseCode} {o.title}
            </div>
            <div className="text-sm text-slate-600">
              {o.semesterName}, {o.sessionCode} · {o.credits} credits
            </div>
            {o.lecturers.length > 0 ? (
              <div className="text-sm text-slate-600">
                {o.lecturers.map((l) => l.lecturerName).join(", ")}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
