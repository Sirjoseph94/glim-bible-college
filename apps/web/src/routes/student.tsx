import type {
  attendance,
  enrollment,
  MyAttendance,
  offerings,
  SemesterRegistration,
  video,
} from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Alert } from "../components/form";
import { useSubmit } from "../components/use-submit";
import { CalendarDate, Time } from "../components/time";

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
const STATUS_LABEL: Record<string, string> = {
  PRESENT: "Present",
  PARTIAL: "Partly present",
  ABSENT: "Absent",
  EXCUSED: "Excused",
};

/** My attendance on one course (TRD §12): a summary, and each Class Meeting on request. */
function MyCourseAttendance({ course }: { course: MyAttendance["courses"][number] }) {
  const s = course.summary;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-slate-700">
        Attendance: {s.present} present, {s.partial} partly, {s.absent} absent
        {s.excused > 0 ? `, ${String(s.excused)} excused` : ""}
        {s.late > 0 ? ` · ${String(s.late)} late` : ""}
      </summary>
      <ul className="mt-2 space-y-1">
        {course.meetings.map((m) => (
          <li key={m.meetingId} className="flex flex-wrap justify-between gap-2">
            <span>
              {m.title}, <Time value={m.scheduledStart} />
            </span>
            <span>
              {STATUS_LABEL[m.status] ?? m.status}
              {m.mode === "IN_PERSON" ? " in the room" : m.mode === "ONLINE" ? " online" : ""}
              {m.late ? ", late" : ""}
              {m.final ? "" : " (provisional)"}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** A course's published recordings (TRD §13.5). Watching comes with the player. */
function CourseRecordings({ offeringId }: { offeringId: string }) {
  const list = useQuery({
    queryKey: ["videos", offeringId],
    queryFn: ({ signal }) =>
      api<typeof video.listVideos>("GET", "/course-offerings/:id/videos", {
        params: { id: offeringId },
        signal,
      }),
  });
  const items = list.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-slate-700">Recordings ({items.length})</summary>
      <ul className="mt-2 space-y-1">
        {items.map((v) => (
          <li key={v.id}>{v.title}</li>
        ))}
      </ul>
    </details>
  );
}

export function CoursesPage() {
  const list = useQuery({
    queryKey: ["offerings", "mine"],
    queryFn: ({ signal }) =>
      api<typeof offerings.listOfferings>("GET", "/course-offerings", { signal }),
  });
  const myAttendance = useQuery({
    queryKey: ["me", "attendance"],
    queryFn: ({ signal }) =>
      api<typeof attendance.getMyAttendance>("GET", "/me/attendance", { signal }),
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
            <CourseRecordings offeringId={o.id} />
            {myAttendance.data?.courses
              .filter((c) => c.offeringId === o.id)
              .map((c) => (
                <MyCourseAttendance key={c.offeringId} course={c} />
              ))}
          </li>
        ))}
      </ul>
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
