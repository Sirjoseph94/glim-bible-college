import type { AcademicSession, calendar, Room, Semester } from "@glim/contracts";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { formText } from "../components/form";
import { CalendarDate } from "../components/time";
import { Badge, type Tone } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Card, cardClass } from "../components/ui/card";
import { ConfirmDialog, Sheet } from "../components/ui/dialog";
import { EmptyState } from "../components/ui/empty-state";
import { TextField } from "../components/ui/field";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
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

const SESSION_STATUS: Record<AcademicSession["status"], { tone: Tone; word: string }> = {
  PLANNED: { tone: "info", word: "Planned" },
  ACTIVE: { tone: "success", word: "Active" },
  CLOSED: { tone: "neutral", word: "Closed" },
};

const SEMESTER_STATUS: Record<Semester["status"], { tone: Tone; word: string }> = {
  PLANNED: { tone: "info", word: "Planned" },
  REGISTRATION: { tone: "brand", word: "Registration open" },
  ACTIVE: { tone: "success", word: "Active" },
  CLOSED: { tone: "neutral", word: "Closed" },
};

/** A closing step waiting for confirmation: it can't be undone. */
type Closing =
  { kind: "session"; id: string; name: string } | { kind: "semester"; id: string; name: string };

/** Academic Sessions, their semesters, and Rooms (TRD §9.1). */
export function AdminCalendarPage() {
  const sessions = useQuery(sessionsQuery);
  const semesters = useQuery(semestersQuery);
  const queryClient = useQueryClient();
  const { busy, problem, run } = useSubmit();
  // The session or semester whose step is running, for its button's spinner.
  const [pending, setPending] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [closing, setClosing] = useState<Closing | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["academic-sessions"] }),
      queryClient.invalidateQueries({ queryKey: ["semesters"] }),
    ]);

  const sessionAction = (id: string, action: SessionAction) => {
    setPending(id);
    void run(async () => {
      await api<SessionTransition>("POST", SESSION_PATHS[action], { params: { id } });
      await refresh();
    });
  };
  const semesterAction = (id: string, action: SemesterAction) => {
    setPending(id);
    void run(async () => {
      await api<SemesterTransition>("POST", SEMESTER_PATHS[action], { params: { id } });
      await refresh();
    });
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Academic calendar"
        meta="Academic Sessions, their semesters, and Rooms."
        actions={
          <Button
            variant="primary"
            icon="calendar"
            onClick={() => {
              setPlanning(true);
            }}
          >
            Plan an Academic Session
          </Button>
        }
      />
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      {sessions.isPending ? (
        <SkeletonGroup label="Loading Academic Sessions">
          <Skeleton className="h-40" />
        </SkeletonGroup>
      ) : sessions.isError ? (
        <LoadFailed what="the Academic Sessions" onRetry={() => void sessions.refetch()} />
      ) : sessions.data.items.length === 0 ? (
        <EmptyState icon="calendar" title="No Academic Sessions yet">
          Plan the first Academic Session, then add its two semesters.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {semesters.isError ? (
            <LoadFailed what="the semesters" onRetry={() => void semesters.refetch()} />
          ) : null}
          {sessions.data.items.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              semesters={
                semesters.data?.items.filter((s) => s.academicSessionId === session.id) ?? []
              }
              loadingId={busy ? pending : null}
              onSessionAction={(action) => {
                if (action === "close")
                  setClosing({ kind: "session", id: session.id, name: session.name });
                else sessionAction(session.id, action);
              }}
              onSemesterAction={(semester, action) => {
                if (action === "close")
                  setClosing({ kind: "semester", id: semester.id, name: semester.name });
                else semesterAction(semester.id, action);
              }}
              onAdded={refresh}
            />
          ))}
        </div>
      )}
      <Rooms />
      <NewSession open={planning} onOpenChange={setPlanning} onCreated={refresh} />
      <ConfirmDialog
        open={closing !== null}
        onOpenChange={(open) => {
          if (!open) setClosing(null);
        }}
        title={
          closing?.kind === "session" ? "Close this Academic Session?" : "Close this semester?"
        }
        confirmLabel={closing?.kind === "session" ? "Close Academic Session" : "Close semester"}
        tone="danger"
        onConfirm={async () => {
          if (closing === null) return;
          if (closing.kind === "session")
            await api<SessionTransition>("POST", SESSION_PATHS.close, {
              params: { id: closing.id },
            });
          else
            await api<SemesterTransition>("POST", SEMESTER_PATHS.close, {
              params: { id: closing.id },
            });
          await refresh();
          setClosing(null);
        }}
      >
        {closing?.kind === "session"
          ? `${closing.name} will be closed. This can't be undone.`
          : `${closing?.name ?? "The semester"} will be closed and its teaching ends. This can't be undone.`}
      </ConfirmDialog>
    </div>
  );
}

function SessionCard(props: {
  session: AcademicSession;
  semesters: Semester[];
  /** The session or semester whose step is running. */
  loadingId: string | null;
  onSessionAction: (action: SessionAction) => void;
  onSemesterAction: (semester: Semester, action: SemesterAction) => void;
  onAdded: () => Promise<unknown>;
}) {
  const { session } = props;
  const status = SESSION_STATUS[session.status];
  const [adding, setAdding] = useState(false);
  const sequence = props.semesters.length === 0 ? 1 : 2;
  const canAddSemester = session.status !== "CLOSED" && props.semesters.length < 2;
  return (
    <section aria-label={session.name} className={`${cardClass()} space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-heading">{session.name}</h2>
            <Badge tone={status.tone}>{status.word}</Badge>
          </div>
          <p className="text-meta text-ink-muted">
            <CalendarDate value={session.startsOn} /> – <CalendarDate value={session.endsOn} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {session.status === "PLANNED" ? (
            <Button
              size="sm"
              variant="primary"
              loading={props.loadingId === session.id}
              onClick={() => {
                props.onSessionAction("activate");
              }}
            >
              Activate Academic Session
            </Button>
          ) : null}
          {session.status === "ACTIVE" ? (
            <Button
              size="sm"
              variant="danger"
              loading={props.loadingId === session.id}
              onClick={() => {
                props.onSessionAction("close");
              }}
            >
              Close session
            </Button>
          ) : null}
        </div>
      </div>
      {props.semesters.length === 0 ? (
        <p className="text-body-sm text-ink-muted">No semesters yet.</p>
      ) : (
        <Card list role="list">
          {props.semesters.map((s) => {
            const next = NEXT_STEP[s.status];
            const semesterStatus = SEMESTER_STATUS[s.status];
            const label = `${s.name} (${s.code})`;
            return (
              <div
                key={s.id}
                role="listitem"
                aria-label={label}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-subhead">{label}</p>
                    <Badge tone={semesterStatus.tone}>{semesterStatus.word}</Badge>
                  </div>
                  <p className="text-meta text-ink-muted">
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
                  </p>
                </div>
                {next ? (
                  <Button
                    size="sm"
                    variant={next.action === "close" ? "danger" : "secondary"}
                    loading={props.loadingId === s.id}
                    onClick={() => {
                      props.onSemesterAction(s, next.action);
                    }}
                  >
                    {next.label}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </Card>
      )}
      {canAddSemester ? (
        <>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setAdding(true);
            }}
          >
            Add semester {sequence}
          </Button>
          <NewSemester
            open={adding}
            onOpenChange={setAdding}
            session={session}
            sequence={sequence}
            onCreated={props.onAdded}
          />
        </>
      ) : null}
    </section>
  );
}

function NewSession({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<unknown>;
}) {
  const formId = useId();
  const { busy, problem, fieldErrors, run } = useSubmit();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Plan an Academic Session"
      description="An Academic Session holds up to two semesters."
      footer={
        <Button type="submit" form={formId} variant="primary" block loading={busy}>
          Plan Academic Session
        </Button>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const d = new FormData(event.currentTarget);
          void run(async () => {
            await api<typeof calendar.createAcademicSession>("POST", "/academic-sessions", {
              body: {
                code: formText(d, "code"),
                name: `${formText(d, "code")} Session`,
                startsOn: formText(d, "startsOn"),
                endsOn: formText(d, "endsOn"),
              },
            });
            await onCreated();
            onOpenChange(false);
          });
        }}
      >
        {problem ? (
          <Banner tone="danger" title={problem.title}>
            {problem.body}
          </Banner>
        ) : null}
        <TextField name="code" label="Code (e.g. 2027/2028)" required error={fieldErrors.code} />
        <TextField
          name="startsOn"
          type="date"
          label="Starts (September)"
          required
          error={fieldErrors.startsOn}
        />
        <TextField
          name="endsOn"
          type="date"
          label="Ends (June)"
          required
          error={fieldErrors.endsOn}
        />
      </form>
    </Sheet>
  );
}

function NewSemester({
  open,
  onOpenChange,
  session,
  sequence,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: AcademicSession;
  sequence: 1 | 2;
  onCreated: () => Promise<unknown>;
}) {
  const formId = useId();
  const { busy, problem, fieldErrors, run } = useSubmit();
  const optional = (d: FormData, key: string) => formText(d, key) || null;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Add semester ${String(sequence)}`}
      description={`${sequence === 1 ? "First" : "Second"} Semester of the ${session.name}.`}
      footer={
        <Button type="submit" form={formId} variant="primary" block loading={busy}>
          Add semester
        </Button>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const d = new FormData(event.currentTarget);
          void run(async () => {
            await api<typeof calendar.createSemester>("POST", "/semesters", {
              body: {
                academicSessionId: session.id,
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
            onOpenChange(false);
          });
        }}
      >
        {problem ? (
          <Banner tone="danger" title={problem.title}>
            {problem.body}
          </Banner>
        ) : null}
        <TextField
          name="startsOn"
          type="date"
          label="Starts"
          required
          error={fieldErrors.startsOn}
        />
        <TextField name="endsOn" type="date" label="Ends" required error={fieldErrors.endsOn} />
        <TextField
          name="registrationOpensOn"
          type="date"
          label="Registration opens"
          optional
          error={fieldErrors.registrationOpensOn}
        />
        <TextField
          name="registrationClosesOn"
          type="date"
          label="Registration closes"
          optional
          error={fieldErrors.registrationClosesOn}
        />
        <TextField
          name="addDropDeadlineOn"
          type="date"
          label="Add/drop deadline"
          optional
          error={fieldErrors.addDropDeadlineOn}
        />
        <TextField
          name="examsStartOn"
          type="date"
          label="Exams start"
          optional
          error={fieldErrors.examsStartOn}
        />
        <TextField
          name="examsEndOn"
          type="date"
          label="Exams end"
          optional
          error={fieldErrors.examsEndOn}
        />
      </form>
    </Sheet>
  );
}

function roomDetail(r: Room): string {
  return r.capacity === null ? "No seat count" : `${String(r.capacity)} seats`;
}

function Rooms() {
  const rooms = useQuery(roomsQuery);
  const queryClient = useQueryClient();
  const formId = useId();
  const [adding, setAdding] = useState(false);
  const { busy, problem, fieldErrors, run } = useSubmit();
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-heading">Rooms</h2>
        <Button
          variant="secondary"
          onClick={() => {
            setAdding(true);
          }}
        >
          Add a Room
        </Button>
      </div>
      {rooms.isPending ? (
        <SkeletonGroup label="Loading Rooms">
          <Skeleton className="h-24" />
        </SkeletonGroup>
      ) : rooms.isError ? (
        <LoadFailed what="the Rooms" onRetry={() => void rooms.refetch()} />
      ) : rooms.data.items.length === 0 ? (
        <EmptyState icon="home" title="No Rooms yet">
          Add the rooms on campus where Class Meetings can take place.
        </EmptyState>
      ) : (
        <Card list role="list">
          {rooms.data.items.map((r) => (
            <div
              key={r.id}
              role="listitem"
              aria-label={`${r.code} ${r.name}`}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <p className="text-body">
                <span className="font-mono text-code">{r.code}</span> {r.name}
              </p>
              <span className="flex items-center gap-2 text-meta text-ink-muted">
                {roomDetail(r)}
                {r.status === "ARCHIVED" ? <Badge tone="neutral">Archived</Badge> : null}
              </span>
            </div>
          ))}
        </Card>
      )}
      <Sheet
        open={adding}
        onOpenChange={setAdding}
        title="Add a Room"
        footer={
          <Button type="submit" form={formId} variant="primary" block loading={busy}>
            Add Room
          </Button>
        }
      >
        <form
          id={formId}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const d = new FormData(event.currentTarget);
            void run(async () => {
              const capacity = formText(d, "capacity");
              await api<typeof calendar.createRoom>("POST", "/rooms", {
                body: {
                  code: formText(d, "code"),
                  name: formText(d, "name"),
                  capacity: capacity === "" ? null : Number(capacity),
                },
              });
              await queryClient.invalidateQueries({ queryKey: ["rooms"] });
              setAdding(false);
            });
          }}
        >
          {problem ? (
            <Banner tone="danger" title={problem.title}>
              {problem.body}
            </Banner>
          ) : null}
          <TextField name="code" label="Room code" required error={fieldErrors.code} />
          <TextField name="name" label="Room name" required error={fieldErrors.name} />
          <TextField
            name="capacity"
            type="number"
            min={1}
            label="Seats"
            optional
            error={fieldErrors.capacity}
          />
        </form>
      </Sheet>
    </section>
  );
}
