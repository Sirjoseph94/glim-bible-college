import type { AcademicSession, calendar, Semester } from "@glim/contracts";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Alert, Field, formText, SubmitButton } from "../components/form";
import { CalendarDate } from "../components/time";
import { useSubmit } from "../components/use-submit";

const sessionsQuery = queryOptions({
  queryKey: ["academic-sessions"],
  queryFn: ({ signal }) =>
    api<typeof calendar.listAcademicSessions>("GET", "/academic-sessions", { signal }),
});
const semestersQuery = queryOptions({
  queryKey: ["semesters"],
  queryFn: ({ signal }) => api<typeof calendar.listSemesters>("GET", "/semesters", { signal }),
});
const roomsQuery = queryOptions({
  queryKey: ["rooms"],
  queryFn: ({ signal }) => api<typeof calendar.listRooms>("GET", "/rooms", { signal }),
});

type SessionAction = "activate" | "close";
type SemesterAction = "open-registration" | "activate" | "close";
type SessionTransition = typeof calendar.activateAcademicSession;
type SemesterTransition = typeof calendar.openSemesterRegistration;

const SESSION_PATHS = {
  activate: "/academic-sessions/:id/activate",
  close: "/academic-sessions/:id/close",
} as const satisfies Record<SessionAction, SessionTransition["path"]>;

const SEMESTER_PATHS = {
  "open-registration": "/semesters/:id/open-registration",
  activate: "/semesters/:id/activate",
  close: "/semesters/:id/close",
} as const satisfies Record<SemesterAction, SemesterTransition["path"]>;

const NEXT_STEP: Partial<Record<Semester["status"], { action: SemesterAction; label: string }>> = {
  PLANNED: { action: "open-registration", label: "Open registration" },
  REGISTRATION: { action: "activate", label: "Start teaching" },
  ACTIVE: { action: "close", label: "Close semester" },
};

/** Academic Sessions, their semesters, and Rooms (TRD §9.1). */
export function AdminCalendarPage() {
  const sessions = useQuery(sessionsQuery);
  const semesters = useQuery(semestersQuery);
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["academic-sessions"] }),
      queryClient.invalidateQueries({ queryKey: ["semesters"] }),
    ]);

  const sessionAction = (id: string, action: SessionAction) => {
    void run(async () => {
      await api<SessionTransition>("POST", SESSION_PATHS[action], { params: { id } });
      await refresh();
    });
  };
  const semesterAction = (id: string, action: SemesterAction) => {
    void run(async () => {
      await api<SemesterTransition>("POST", SEMESTER_PATHS[action], { params: { id } });
      await refresh();
    });
  };

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-semibold">Academic calendar</h2>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {sessions.data?.items.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          semesters={semesters.data?.items.filter((s) => s.academicSessionId === session.id) ?? []}
          busy={busy}
          onSessionAction={(action) => {
            sessionAction(session.id, action);
          }}
          onSemesterAction={semesterAction}
          onAdded={refresh}
        />
      ))}
      <NewSession onCreated={refresh} />
      <Rooms />
    </div>
  );
}

function SessionCard(props: {
  session: AcademicSession;
  semesters: Semester[];
  busy: boolean;
  onSessionAction: (action: SessionAction) => void;
  onSemesterAction: (id: string, action: SemesterAction) => void;
  onAdded: () => Promise<unknown>;
}) {
  const { session } = props;
  return (
    <section
      aria-label={session.name}
      className="space-y-3 rounded border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          {session.name}{" "}
          <span className="text-sm font-normal text-slate-600">
            · {session.status.toLowerCase()}
          </span>
        </h3>
        <span className="text-sm text-slate-600">
          <CalendarDate value={session.startsOn} /> – <CalendarDate value={session.endsOn} />
        </span>
      </div>
      <ul className="space-y-2">
        {props.semesters.map((s) => {
          const next = NEXT_STEP[s.status];
          return (
            <li key={s.id} className="rounded border border-slate-100 p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {s.name} ({s.code}) · {s.status.toLowerCase()}
                </span>
                {next ? (
                  <button
                    type="button"
                    className="underline"
                    disabled={props.busy}
                    onClick={() => {
                      props.onSemesterAction(s.id, next.action);
                    }}
                  >
                    {next.label}
                  </button>
                ) : null}
              </div>
              <div className="text-slate-600">
                <CalendarDate value={s.startsOn} /> – <CalendarDate value={s.endsOn} />
                {s.examsStartOn ? (
                  <>
                    {" "}
                    · exams <CalendarDate value={s.examsStartOn} /> –{" "}
                    <CalendarDate value={s.examsEndOn} />
                  </>
                ) : null}
                {s.addDropDeadlineOn ? (
                  <>
                    {" "}
                    · add/drop until <CalendarDate value={s.addDropDeadlineOn} />
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-3 text-sm">
        {session.status === "PLANNED" ? (
          <button
            type="button"
            className="underline"
            disabled={props.busy}
            onClick={() => {
              props.onSessionAction("activate");
            }}
          >
            Activate session
          </button>
        ) : null}
        {session.status === "ACTIVE" ? (
          <button
            type="button"
            className="underline"
            disabled={props.busy}
            onClick={() => {
              props.onSessionAction("close");
            }}
          >
            Close session
          </button>
        ) : null}
      </div>
      {session.status !== "CLOSED" && props.semesters.length < 2 ? (
        <NewSemester
          sessionId={session.id}
          sequence={props.semesters.length === 0 ? 1 : 2}
          onCreated={props.onAdded}
        />
      ) : null}
    </section>
  );
}

function NewSession({ onCreated }: { onCreated: () => Promise<unknown> }) {
  const { busy, error, fieldErrors, run } = useSubmit();
  return (
    <details className="rounded border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-medium">Plan an Academic Session</summary>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const d = new FormData(form);
          void run(async () => {
            await api<typeof calendar.createAcademicSession>("POST", "/academic-sessions", {
              body: {
                code: formText(d, "code"),
                name: `${formText(d, "code")} Session`,
                startsOn: formText(d, "startsOn"),
                endsOn: formText(d, "endsOn"),
              },
            });
            form.reset();
            await onCreated();
          });
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field
          id="s-code"
          name="code"
          label="Code (e.g. 2027/2028)"
          required
          error={fieldErrors.code}
        />
        <Field id="s-starts" name="startsOn" type="date" label="Starts (September)" required />
        <Field id="s-ends" name="endsOn" type="date" label="Ends (June)" required />
        <SubmitButton busy={busy}>Plan session</SubmitButton>
      </form>
    </details>
  );
}

function NewSemester({
  sessionId,
  sequence,
  onCreated,
}: {
  sessionId: string;
  sequence: 1 | 2;
  onCreated: () => Promise<unknown>;
}) {
  const { busy, error, run } = useSubmit();
  const optional = (d: FormData, key: string) => formText(d, key) || null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer underline">Add semester {sequence}</summary>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const d = new FormData(event.currentTarget);
          void run(async () => {
            await api<typeof calendar.createSemester>("POST", "/semesters", {
              body: {
                academicSessionId: sessionId,
                code: `S${String(sequence)}`,
                name: sequence === 1 ? "First Semester" : "Second Semester",
                sequence,
                startsOn: formText(d, "startsOn"),
                endsOn: formText(d, "endsOn"),
                registrationOpensOn: optional(d, "registrationOpensOn"),
                registrationClosesOn: optional(d, "registrationClosesOn"),
                addDropDeadlineOn: optional(d, "addDropDeadlineOn"),
                examsStartOn: optional(d, "examsStartOn"),
                examsEndOn: optional(d, "examsEndOn"),
              },
            });
            await onCreated();
          });
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field id={`${sessionId}-start`} name="startsOn" type="date" label="Starts" required />
        <Field id={`${sessionId}-end`} name="endsOn" type="date" label="Ends" required />
        <Field
          id={`${sessionId}-ro`}
          name="registrationOpensOn"
          type="date"
          label="Registration opens"
        />
        <Field
          id={`${sessionId}-rc`}
          name="registrationClosesOn"
          type="date"
          label="Registration closes"
        />
        <Field
          id={`${sessionId}-ad`}
          name="addDropDeadlineOn"
          type="date"
          label="Add/drop deadline"
        />
        <Field id={`${sessionId}-es`} name="examsStartOn" type="date" label="Exams start" />
        <Field id={`${sessionId}-ee`} name="examsEndOn" type="date" label="Exams end" />
        <SubmitButton busy={busy}>Add semester</SubmitButton>
      </form>
    </details>
  );
}

function Rooms() {
  const rooms = useQuery(roomsQuery);
  const queryClient = useQueryClient();
  const { busy, error, fieldErrors, run } = useSubmit();
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">Rooms</h3>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white text-sm">
        {rooms.data?.items.map((r) => (
          <li key={r.id} className="flex justify-between px-3 py-2">
            <span>
              <span className="font-medium">{r.code}</span> {r.name}
            </span>
            <span className="text-slate-600">
              {r.capacity === null ? "" : `${String(r.capacity)} seats`}
              {r.status === "ARCHIVED" ? " · archived" : ""}
            </span>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-3 sm:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const d = new FormData(form);
          void run(async () => {
            const capacity = formText(d, "capacity");
            await api<typeof calendar.createRoom>("POST", "/rooms", {
              body: {
                code: formText(d, "code"),
                name: formText(d, "name"),
                capacity: capacity === "" ? null : Number(capacity),
              },
            });
            form.reset();
            await queryClient.invalidateQueries({ queryKey: ["rooms"] });
          });
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field id="r-code" name="code" label="Room code" required error={fieldErrors.code} />
        <Field id="r-name" name="name" label="Room name" required />
        <Field id="r-cap" name="capacity" type="number" min={1} label="Seats (optional)" />
        <SubmitButton busy={busy}>Add Room</SubmitButton>
      </form>
    </section>
  );
}
