import type { attendance, MeetingAttendance, RollCall, RollCallMark } from "@glim/contracts";
import { Time } from "../components/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { Alert, formText } from "../components/form";

type Mark = Omit<RollCallMark, "studentId">;
type Status = "idle" | "saving" | "saved" | "retry" | "error";

const RETRY_MS = 4000;
const storageKey = (meetingId: string) => `glim:roll-call:${meetingId}`;

/** Unsent marks survive a reload (and a dead phone battery) in local storage. */
function loadPending(meetingId: string): Record<string, Mark> {
  try {
    const raw = window.localStorage.getItem(storageKey(meetingId));
    return raw === null ? {} : (JSON.parse(raw) as Record<string, Mark>);
  } catch {
    return {};
  }
}

function savePending(meetingId: string, pending: Record<string, Mark>): void {
  try {
    if (Object.keys(pending).length === 0) window.localStorage.removeItem(storageKey(meetingId));
    else window.localStorage.setItem(storageKey(meetingId), JSON.stringify(pending));
  } catch {
    // Private mode or full storage: marks still go out from memory.
  }
}

const same = (a: Mark | null | undefined, b: Mark | null | undefined) =>
  a?.present === b?.present && a?.late === b?.late && a?.mode === b?.mode;

const STATUS_TEXT: Record<Status, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  retry: "Offline — will retry",
  error: "",
};

/**
 * Roll call on a phone (TRD §12.3, §18.4): enrolled students, on-campus first, with photos.
 * Each tap is queued locally and sent in batches with `If-Match`; on a flaky connection the
 * queue is kept and retried, and the header says "Saved" or "will retry".
 */
export function RollCallPage() {
  const { meetingId } = useParams({ from: "/teach/meetings/$meetingId/roll-call" });
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["roll-call", meetingId], [meetingId]);
  const rollCall = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      api<typeof attendance.getRollCall>("GET", "/class-meetings/:id/roll-call", {
        params: { id: meetingId },
        signal,
      }),
  });
  const [pending, setPending] = useState<Record<string, Mark>>(() => loadPending(meetingId));
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const retryTimer = useRef<number | null>(null);

  useEffect(() => {
    savePending(meetingId, pending);
  }, [meetingId, pending]);

  const flush = useCallback(async () => {
    const view = queryClient.getQueryData<RollCall>(queryKey);
    if (sending.current || view === undefined) return;
    const batch = Object.entries(pendingRef.current);
    if (batch.length === 0) return;
    sending.current = true;
    setStatus("saving");
    try {
      const saved = await api<typeof attendance.putRollCall>(
        "PUT",
        "/class-meetings/:id/roll-call",
        {
          params: { id: meetingId },
          headers: { "if-match": `"${String(view.version)}"` },
          body: { marks: batch.map(([studentId, mark]) => ({ studentId, ...mark })) },
        },
      );
      queryClient.setQueryData(queryKey, saved);
      // Keep anything tapped while this batch was in flight.
      setPending((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([studentId, mark]) =>
              !batch.some(([id, sent]) => id === studentId && same(mark, sent)),
          ),
        ),
      );
      setStatus("saved");
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) {
        // Someone else saved: take their version and send ours again.
        await queryClient.invalidateQueries({ queryKey });
        setStatus("retry");
        retryTimer.current = window.setTimeout(() => void flush(), 200);
      } else if (e instanceof ApiError) {
        setStatus("error");
        setError(e.message);
      } else {
        setStatus("retry");
        retryTimer.current = window.setTimeout(() => void flush(), RETRY_MS);
      }
    } finally {
      sending.current = false;
    }
  }, [meetingId, queryClient, queryKey]);

  // Send whenever there's something queued; retry when the connection comes back.
  useEffect(() => {
    if (Object.keys(pending).length === 0 || rollCall.data === undefined) return;
    const timer = window.setTimeout(() => void flush(), 400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [pending, rollCall.data, flush]);
  useEffect(() => {
    const online = () => void flush();
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("online", online);
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    };
  }, [flush]);

  const mark = (studentId: string, next: Mark) => {
    setPending((current) => ({ ...current, [studentId]: next }));
  };

  if (rollCall.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (rollCall.isError) return <Alert tone="error">{rollCall.error.message}</Alert>;
  const view = rollCall.data;
  const shown = (studentId: string, server: Mark | null) => pending[studentId] ?? server;
  const queued = Object.keys(pending).length;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">Roll call</h2>
        <span
          role="status"
          className={status === "retry" ? "text-sm text-amber-800" : "text-sm text-slate-600"}
        >
          {STATUS_TEXT[status]}
          {queued > 0 && status !== "saving" ? ` (${String(queued)} waiting)` : ""}
        </span>
      </div>
      <Link to="/teach" className="text-sm text-brand underline">
        Back to my offerings
      </Link>
      {view.open ? null : <Alert tone="error">Roll call isn't open for this class now.</Alert>}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <button
        type="button"
        disabled={!view.open}
        className="rounded bg-brand px-3 py-2 text-sm font-medium text-white"
        onClick={() => {
          for (const s of view.students)
            if (s.studyMode === "ON_CAMPUS") {
              const current = shown(s.studentId, s.mark);
              mark(s.studentId, { present: true, late: current?.late ?? false, mode: "IN_PERSON" });
            }
        }}
      >
        Mark all on-campus present
      </button>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {view.students.map((s) => {
          const current = shown(s.studentId, s.mark);
          const choose = (choice: "IN_PERSON" | "ONLINE" | "ABSENT") => {
            mark(
              s.studentId,
              choice === "ABSENT"
                ? { present: false, late: false, mode: current?.mode ?? "IN_PERSON" }
                : { present: true, late: current?.late ?? false, mode: choice },
            );
          };
          const on = (choice: "IN_PERSON" | "ONLINE" | "ABSENT") =>
            choice === "ABSENT"
              ? current?.present === false
              : current?.present === true && current.mode === choice;
          return (
            <li key={s.studentId} aria-label={s.name} className="space-y-2 p-3">
              <div className="flex items-center gap-3">
                {s.photoUrl ? (
                  <img
                    src={s.photoUrl}
                    alt=""
                    className="h-14 w-11 rounded object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-14 w-11 rounded bg-slate-200" aria-hidden="true" />
                )}
                <div>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-slate-600">
                    {s.matricNumber} · {s.studyMode === "ON_CAMPUS" ? "On campus" : "Online"}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label={`Mark ${s.name}`}>
                {(
                  [
                    ["IN_PERSON", "In room"],
                    ["ONLINE", "Online"],
                    ["ABSENT", "Absent"],
                  ] as const
                ).map(([choice, label]) => (
                  <button
                    key={choice}
                    type="button"
                    disabled={!view.open}
                    aria-pressed={on(choice)}
                    className={
                      on(choice)
                        ? "rounded bg-slate-800 px-3 py-2 text-sm text-white"
                        : "rounded border border-slate-300 px-3 py-2 text-sm"
                    }
                    onClick={() => {
                      choose(choice);
                    }}
                  >
                    {label}
                  </button>
                ))}
                <label className="flex items-center gap-1 px-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={!view.open || current?.present !== true}
                    checked={current?.late === true}
                    onChange={(e) => {
                      if (current?.present === true)
                        mark(s.studentId, { ...current, late: e.currentTarget.checked });
                    }}
                  />
                  Late
                </label>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const RECORD_LABEL: Record<string, string> = {
  PRESENT: "Present",
  PARTIAL: "Partly present",
  ABSENT: "Absent",
  EXCUSED: "Excused",
};

type AttendanceRecord = MeetingAttendance["records"][number];

/** Override a record with a reason, or clear an override (TRD §12.7). */
function OverrideControl({ meetingId, record }: { meetingId: string; record: AttendanceRecord }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ["attendance", meetingId] });
    setOpen(false);
  };
  const call = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await done();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "We couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  };
  if (!open)
    return (
      <span className="flex gap-3">
        <button
          type="button"
          className="text-brand underline"
          onClick={() => {
            setOpen(true);
          }}
        >
          Change
        </button>
        {record.overrideStatus === null ? null : (
          <button
            type="button"
            disabled={busy}
            className="text-red-700 underline"
            onClick={() =>
              void call(() =>
                api<typeof attendance.clearAttendanceOverride>(
                  "DELETE",
                  "/class-meetings/:id/attendance/:studentId/override",
                  { params: { id: meetingId, studentId: record.studentId } },
                ),
              )
            }
          >
            Undo change
          </button>
        )}
      </span>
    );
  return (
    <form
      className="mt-2 w-full space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void call(() =>
          api<typeof attendance.overrideAttendance>(
            "POST",
            "/class-meetings/:id/attendance/:studentId/override",
            {
              params: { id: meetingId, studentId: record.studentId },
              body: {
                status: formText(form, "status") as AttendanceRecord["status"],
                reason: formText(form, "reason"),
              },
            },
          ),
        );
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <label className="block text-sm">
        <span className="font-medium">Status</span>
        <select
          name="status"
          defaultValue="EXCUSED"
          className="block w-full rounded border border-slate-300 bg-white px-2 py-2"
        >
          {Object.entries(RECORD_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="font-medium">Reason (at least 5 characters)</span>
        <input
          name="reason"
          required
          minLength={5}
          className="block w-full rounded border border-slate-300 px-2 py-2"
        />
      </label>
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-brand px-3 py-1.5 text-sm text-white"
        >
          Save
        </button>
        <button
          type="button"
          className="text-sm underline"
          onClick={() => {
            setOpen(false);
          }}
        >
          Back
        </button>
      </div>
    </form>
  );
}

/** A Class Meeting's attendance records, for its Lecturers (TRD §12.5). */
export function MeetingAttendancePage() {
  const { meetingId } = useParams({ from: "/teach/meetings/$meetingId/attendance" });
  const records = useQuery({
    queryKey: ["attendance", meetingId],
    queryFn: ({ signal }) =>
      api<typeof attendance.getMeetingAttendance>("GET", "/class-meetings/:id/attendance", {
        params: { id: meetingId },
        signal,
      }),
  });
  if (records.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (records.isError) return <Alert tone="error">{records.error.message}</Alert>;
  const view = records.data;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Attendance</h2>
      <div className="flex gap-4 text-sm">
        <Link to="/teach" className="text-brand underline">
          Back to my offerings
        </Link>
        <Link
          to="/teach/meetings/$meetingId/roll-call"
          params={{ meetingId }}
          className="text-brand underline"
        >
          Roll call
        </Link>
      </div>
      <p className="text-sm text-slate-700">
        {view.attendanceState === "FINAL" ? (
          <>
            Final. Roll call can still change it until <Time value={view.lockedAt} />.
          </>
        ) : view.attendanceState === "PENDING" ? (
          "Not taken yet."
        ) : (
          "Provisional: it becomes final shortly after the class ends."
        )}
      </p>
      {view.records.length === 0 ? (
        <p className="text-slate-600">No attendance yet. Take roll call to record it.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white text-sm">
          {view.records.map((r) => (
            <li key={r.studentId} className="flex flex-wrap justify-between gap-2 p-3">
              <span>
                {r.name} <span className="text-slate-500">{r.matricNumber}</span>
              </span>
              <span>
                {RECORD_LABEL[r.status] ?? r.status}
                {r.mode === "IN_PERSON" ? " in the room" : r.mode === "ONLINE" ? " online" : ""}
                {r.late ? ", late" : ""}
                {r.overrideStatus === null ? "" : " (changed by staff)"}
              </span>
              <OverrideControl meetingId={meetingId} record={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
