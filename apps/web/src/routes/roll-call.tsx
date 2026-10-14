import type {
  attendance,
  ClassMeeting,
  meetings,
  MeetingAttendance,
  RollCall,
  RollCallMark,
} from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type SubmitEvent } from "react";
import { api, ApiError } from "../api/client";
import { describeError, type ErrorCopy } from "../api/error-copy";
import { PageHeader } from "../components/app/page-header";
import { isNotAvailable, LoadFailed, NotAvailable } from "../components/app/page-states";
import { useDetailBar } from "../components/app/shell-parts";
import { AttendanceRow } from "../components/teaching/attendance-row";
import { MeetParticipants } from "../components/teaching/meet-participants";
import { Time } from "../components/time";
import { Badge, type BadgeStatus, type Tone } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button, buttonClass } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Checkbox, Radio } from "../components/ui/choice";
import { Sheet } from "../components/ui/dialog";
import { TextField } from "../components/ui/field";
import { EmptyState } from "../components/ui/empty-state";
import { OfflineBanner, QueuedPill, useOnline } from "../components/ui/offline";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { cn } from "../design/cn";
import { queueWork, useQueued, type QueuedWork } from "../offline";

type Mark = Omit<RollCallMark, "studentId">;

/** Taps are gathered this long and sent as one batch. */
const BATCH_MS = 400;

const rollCallPath = "/class-meetings/:id/roll-call";

function useMeeting(meetingId: string) {
  return useQuery({
    queryKey: ["class-meeting", meetingId],
    queryFn: ({ signal }) =>
      api<typeof meetings.getClassMeeting>("GET", "/class-meetings/:id", {
        params: { id: meetingId },
        signal,
      }),
  });
}

/** Back to the course's Class Meetings, with the course code in the bar (§9.10). */
function useBackToCourse(meeting: ClassMeeting | undefined) {
  useDetailBar(
    meeting
      ? {
          back: {
            to: "/teach/$offeringId",
            params: { offeringId: meeting.courseOfferingId },
            search: { tab: "live" },
            label: "Class Meetings",
          },
          code: meeting.courseCode,
        }
      : { back: { to: "/teach", label: "Teaching" } },
  );
}

/** "Kings of Judah, part 2 · Mon 12 Oct, 10:00" under a page's title. */
function MeetingMeta({ meeting }: { meeting: ClassMeeting | undefined }) {
  if (meeting === undefined) return null;
  return (
    <>
      {meeting.title} · <Time value={meeting.scheduledStart} />
    </>
  );
}

/**
 * Marks the previous roll-call page left unsent in local storage: taken over once, so they go
 * out through the queue. (Remove after every phone has opened roll call since; WP-UI-12.)
 */
function takeLegacyMarks(meetingId: string): Record<string, Mark> {
  const key = `glim:roll-call:${meetingId}`;
  try {
    const raw = window.localStorage.getItem(key);
    window.localStorage.removeItem(key);
    return raw === null ? {} : (JSON.parse(raw) as Record<string, Mark>);
  } catch {
    return {};
  }
}

/** The marks in queued roll-call batches, oldest first, so the latest tap wins. */
function queuedMarks(items: QueuedWork[]): Record<string, Mark> {
  const marks: Record<string, Mark> = {};
  for (const work of items)
    for (const step of work.steps)
      for (const { studentId, ...mark } of (step.body as { marks: RollCallMark[] }).marks)
        marks[studentId] = mark;
  return marks;
}

const same = (a: Mark | null | undefined, b: Mark | null | undefined) =>
  a?.present === b?.present && a?.late === b?.late && a?.mode === b?.mode;

const CHOICES = [
  ["IN_PERSON", "In the room"],
  ["ONLINE", "Online"],
  ["ABSENT", "Absent"],
] as const;

/**
 * Roll call on a phone (TRD §12.3, §18.4; decision UI-Q4, composed from §9.18 and §9.20):
 * enrolled students, on-campus first, with photos. Taps are gathered into batches and go through
 * the offline queue, so marks made with no signal are kept on the phone and sent on reconnect,
 * on top of whatever another device saved meanwhile.
 */
export function RollCallPage() {
  const { meetingId } = useParams({ from: "/teach/meetings/$meetingId/roll-call" });
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["roll-call", meetingId], [meetingId]);
  const meeting = useMeeting(meetingId);
  useBackToCourse(meeting.data);
  const rollCall = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      api<typeof attendance.getRollCall>("GET", rollCallPath, {
        params: { id: meetingId },
        signal,
      }),
  });
  const online = useOnline();
  const group = `roll-call:${meetingId}`;
  const queued = useQueued(group);
  const [local, setLocal] = useState<Record<string, Mark>>(() => takeLegacyMarks(meetingId));
  const [everSaved, setEverSaved] = useState(false);
  const [refused, setRefused] = useState<ErrorCopy | null>(null);
  const localRef = useRef(local);
  const version = useRef<number | null>(null);
  useEffect(() => {
    localRef.current = local;
  }, [local]);
  useEffect(() => {
    if (rollCall.data) version.current = rollCall.data.version;
  }, [rollCall.data]);
  const loaded = rollCall.data !== undefined;

  const queueBatch = useCallback(
    (batch: Record<string, Mark>) =>
      queueWork({
        key: crypto.randomUUID(),
        group,
        steps: [
          {
            method: "PUT",
            path: rollCallPath,
            params: { id: meetingId },
            body: {
              marks: Object.entries(batch).map(([studentId, mark]) => ({ studentId, ...mark })),
            },
            ifMatch: { version: version.current ?? 0, refreshFrom: rollCallPath },
          },
        ],
      }),
    [group, meetingId],
  );

  // Leaving the page with taps not yet batched: queue them now rather than lose them.
  useEffect(
    () => () => {
      const batch = localRef.current;
      if (Object.keys(batch).length > 0 && version.current !== null) void queueBatch(batch);
    },
    [queueBatch],
  );

  // Gather taps for a moment, then hand them to the queue as one batch.
  useEffect(() => {
    if (Object.keys(local).length === 0 || !loaded) return;
    const timer = window.setTimeout(() => {
      const batch = localRef.current;
      void queueBatch(batch).then(() => {
        // Keep anything tapped again while the batch was being stored.
        setLocal((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([id, mark]) => !same(mark, batch[id])),
          ),
        );
      });
    }, BATCH_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [local, loaded, queueBatch]);

  // After a send, show the server's marks; a refused batch is said once.
  useEffect(() => {
    if (queued.last === null) return;
    if (queued.last.sent.length > 0) setEverSaved(true);
    const rejected = queued.last.rejected[0];
    setRefused(rejected ? describeError(rejected.error) : null);
    void queryClient.invalidateQueries({ queryKey });
  }, [queued.last, queryClient, queryKey]);

  if (rollCall.isPending)
    return (
      <SkeletonGroup label="Loading the roll call">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-60" />
      </SkeletonGroup>
    );
  if (rollCall.isError)
    return isNotAvailable(rollCall.error) ? (
      <NotAvailable />
    ) : (
      <LoadFailed what="the roll call" onRetry={() => void rollCall.refetch()} />
    );
  const view: RollCall = rollCall.data;
  const waiting = { ...queuedMarks(queued.items), ...local };
  const shown = (studentId: string, server: Mark | null) => waiting[studentId] ?? server;
  const waitingCount = Object.keys(waiting).length;
  const mark = (studentId: string, next: Mark) => {
    setRefused(null);
    setLocal((current) => ({ ...current, [studentId]: next }));
  };

  return (
    <div className="space-y-4">
      {online ? null : <OfflineBanner />}
      <PageHeader title="Roll call" meta={<MeetingMeta meeting={meeting.data} />} />
      {view.open ? null : (
        <Banner tone="warning" title="Roll call isn't open for this class now">
          It opens <Time value={view.opensAt} />.
        </Banner>
      )}
      {refused ? (
        <Banner tone="danger" title="Some marks weren't saved">
          {refused.title}. {refused.body}
        </Banner>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={!view.open}
          onClick={() => {
            for (const s of view.students)
              if (s.studyMode === "ON_CAMPUS") {
                const current = shown(s.studentId, s.mark);
                mark(s.studentId, {
                  present: true,
                  late: current?.late ?? false,
                  mode: "IN_PERSON",
                });
              }
          }}
        >
          Mark all on-campus present
        </Button>
        <span role="status" aria-label="Marks" className="text-body-sm text-ink-muted">
          {waitingCount > 0 ? (
            <QueuedPill count={waitingCount} noun={["mark", "marks"]} />
          ) : everSaved ? (
            "Saved"
          ) : (
            ""
          )}
        </span>
      </div>
      <Card list role="list">
        {view.students.map((s) => {
          const current = shown(s.studentId, s.mark);
          const on = (choice: (typeof CHOICES)[number][0]) =>
            choice === "ABSENT"
              ? current?.present === false
              : current?.present === true && current.mode === choice;
          return (
            <AttendanceRow
              key={s.studentId}
              name={s.name}
              photoUrl={s.photoUrl}
              meta={`${s.matricNumber} · ${s.studyMode === "ON_CAMPUS" ? "On campus" : "Online"}`}
              below={
                <div
                  role="group"
                  aria-label={`Mark ${s.name}`}
                  className="flex flex-wrap items-center gap-2"
                >
                  {CHOICES.map(([choice, label]) => (
                    <button
                      key={choice}
                      type="button"
                      disabled={!view.open}
                      aria-pressed={on(choice)}
                      className={cn(
                        "min-h-tap rounded-md border px-3 text-body-sm font-semibold",
                        "disabled:cursor-not-allowed disabled:opacity-55",
                        on(choice)
                          ? choice === "ABSENT"
                            ? "border-danger bg-danger-soft text-danger"
                            : "border-brand bg-brand-soft text-brand"
                          : "border-line-strong bg-surface-raised text-ink",
                      )}
                      onClick={() => {
                        mark(
                          s.studentId,
                          choice === "ABSENT"
                            ? { present: false, late: false, mode: current?.mode ?? "IN_PERSON" }
                            : { present: true, late: current?.late ?? false, mode: choice },
                        );
                      }}
                    >
                      {label}
                    </button>
                  ))}
                  <Checkbox
                    label="Late"
                    className="px-2"
                    disabled={!view.open || current?.present !== true}
                    checked={current?.late === true}
                    onChange={(e) => {
                      if (current?.present === true)
                        mark(s.studentId, { ...current, late: e.currentTarget.checked });
                    }}
                  />
                </div>
              }
            />
          );
        })}
      </Card>
    </div>
  );
}

type AttendanceRecord = MeetingAttendance["records"][number];
type Status = AttendanceRecord["status"];

const STATUS: Record<Status, { badge: BadgeStatus; word: string; tone: Tone }> = {
  PRESENT: { badge: "present", word: "Present", tone: "success" },
  PARTIAL: { badge: "partial", word: "Partial", tone: "warning" },
  ABSENT: { badge: "absent", word: "Absent", tone: "danger" },
  EXCUSED: { badge: "excused", word: "Excused", tone: "info" },
};

/** §11.8: the ones to look at first. */
const ORDER: Status[] = ["ABSENT", "PARTIAL", "PRESENT", "EXCUSED"];
const SUMMARY: Status[] = ["PRESENT", "PARTIAL", "ABSENT", "EXCUSED"];

function recordMeta(r: AttendanceRecord): string {
  return [
    r.mode === "IN_PERSON" ? "In the room" : r.mode === "ONLINE" ? "Online" : null,
    r.late ? "late" : null,
    r.matricNumber,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Overrides waiting in the queue, by student. */
function queuedOverrides(items: QueuedWork[]): Record<string, Status> {
  const out: Record<string, Status> = {};
  for (const work of items)
    for (const step of work.steps) {
      const body = step.body as { status: Status };
      const studentId = step.params?.studentId;
      if (studentId !== undefined) out[studentId] = body.status;
    }
  return out;
}

/**
 * Change one student's attendance (TRD §12.7, §9.18): a status and a reason. With no
 * connection the change waits on the phone and is sent on reconnect (§10.4).
 */
function OverrideSheet({
  meetingId,
  record,
  onClose,
}: {
  meetingId: string;
  record: AttendanceRecord | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ErrorCopy | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ["attendance", meetingId] });
    onClose();
  };
  const call = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await action();
      await done();
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (record === null) return;
    const form = new FormData(event.currentTarget);
    const status = form.get("status") as Status;
    const reason = (form.get("reason") as string).trim();
    if (reason.length < 5) {
      setReasonError("Write at least 5 characters.");
      return;
    }
    setReasonError(null);
    const params = { id: meetingId, studentId: record.studentId };
    setBusy(true);
    setProblem(null);
    try {
      await api<typeof attendance.overrideAttendance>(
        "POST",
        "/class-meetings/:id/attendance/:studentId/override",
        { params, body: { status, reason } },
      );
      await done();
    } catch (error) {
      if (error instanceof ApiError) setProblem(describeError(error));
      else {
        // No connection: keep the change on the phone and send it on reconnect.
        await queueWork({
          key: crypto.randomUUID(),
          group: `attendance:${meetingId}`,
          steps: [
            {
              method: "POST",
              path: "/class-meetings/:id/attendance/:studentId/override",
              params,
              body: { status, reason },
            },
          ],
        });
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={record !== null}
      onOpenChange={(open) => {
        if (!open) {
          setProblem(null);
          setReasonError(null);
          onClose();
        }
      }}
      title={record ? `Change attendance for ${record.name}` : "Change attendance"}
      description="Your change stays even when attendance is worked out again."
      footer={
        <>
          <Button type="submit" form={formId} variant="primary" block loading={busy}>
            Save change
          </Button>
          {record?.overrideStatus != null ? (
            <Button
              variant="secondary"
              block
              disabled={busy}
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
            </Button>
          ) : null}
        </>
      }
    >
      {record ? (
        <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-4">
          {problem ? (
            <Banner tone="danger" title={problem.title}>
              {problem.body}
            </Banner>
          ) : null}
          <fieldset>
            <legend className="text-label">Status</legend>
            {(Object.keys(STATUS) as Status[]).map((status) => (
              <Radio
                key={status}
                name="status"
                value={status}
                label={STATUS[status].word}
                defaultChecked={status === (record.overrideStatus ?? "EXCUSED")}
              />
            ))}
          </fieldset>
          <TextField
            name="reason"
            label="Reason"
            hint="At least 5 characters. Kept with the record."
            required
            maxLength={500}
            error={reasonError ?? undefined}
          />
        </form>
      ) : null}
    </Sheet>
  );
}

/**
 * A Class Meeting's attendance, for its Lecturers (TRD §12.5; handoff §11.8): the counts, then
 * every student, the ones to look at first. ("Participants we couldn't match" and the policy's
 * thresholds wait on the API: .scratch/ui-overhaul/issues/02.)
 */
export function MeetingAttendancePage() {
  const { meetingId } = useParams({ from: "/teach/meetings/$meetingId/attendance" });
  const meeting = useMeeting(meetingId);
  useBackToCourse(meeting.data);
  const records = useQuery({
    queryKey: ["attendance", meetingId],
    queryFn: ({ signal }) =>
      api<typeof attendance.getMeetingAttendance>("GET", "/class-meetings/:id/attendance", {
        params: { id: meetingId },
        signal,
      }),
  });
  const online = useOnline();
  const group = `attendance:${meetingId}`;
  const queued = useQueued(group);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [refused, setRefused] = useState<ErrorCopy | null>(null);

  useEffect(() => {
    if (queued.last === null) return;
    const rejected = queued.last.rejected[0];
    setRefused(rejected ? describeError(rejected.error) : null);
    void queryClient.invalidateQueries({ queryKey: ["attendance", meetingId] });
  }, [queued.last, queryClient, meetingId]);

  if (records.isPending)
    return (
      <SkeletonGroup label="Loading attendance">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-60" />
      </SkeletonGroup>
    );
  if (records.isError)
    return isNotAvailable(records.error) ? (
      <NotAvailable />
    ) : (
      <LoadFailed what="the attendance" onRetry={() => void records.refetch()} />
    );
  const view = records.data;
  const pending = queuedOverrides(queued.items);
  const statusOf = (r: AttendanceRecord): Status => pending[r.studentId] ?? r.status;
  const sorted = [...view.records].sort(
    (a, b) =>
      ORDER.indexOf(statusOf(a)) - ORDER.indexOf(statusOf(b)) || a.name.localeCompare(b.name),
  );
  // "21 Present · 3 Partial · 2 Absent · 1 Excused": every record counted once (§11.8).
  const counts = SUMMARY.map((status) => ({
    status,
    count: view.records.filter((r) => statusOf(r) === status).length,
  }));

  return (
    <div className="space-y-4">
      {online ? null : <OfflineBanner />}
      <PageHeader title="Attendance" meta={<MeetingMeta meeting={meeting.data} />} />
      <p className="text-body-sm text-ink">
        {view.attendanceState === "FINAL" ? (
          <>
            Final. Roll call can still change it until <Time value={view.lockedAt} />.
          </>
        ) : view.attendanceState === "PENDING" ? (
          "Not taken yet."
        ) : view.attendanceState === "REVIEW_REQUIRED" ? (
          "Needs your check: someone in the Google Meet call isn't identified yet, or the call was much shorter than the class."
        ) : (
          "Provisional: it becomes final shortly after the class ends."
        )}
      </p>
      {refused ? (
        <Banner tone="danger" title="A change wasn't saved">
          {refused.title}. {refused.body}
        </Banner>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {view.records.length === 0 ? (
            <EmptyState icon="users" title="No attendance yet">
              Take roll call to record it.
            </EmptyState>
          ) : (
            <>
              <ul aria-label="Summary" className="flex flex-wrap gap-2">
                {counts.map(({ status, count }) => (
                  <li key={status}>
                    <Badge tone={STATUS[status].tone}>
                      {count} {STATUS[status].word}
                    </Badge>
                  </li>
                ))}
              </ul>
              <span role="status">
                <QueuedPill count={queued.count} noun={["change", "changes"]} />
              </span>
              <Card list role="list">
                {sorted.map((r) => (
                  <AttendanceRow
                    key={r.studentId}
                    name={r.name}
                    meta={
                      pending[r.studentId] ? `${recordMeta(r)} · waiting to send` : recordMeta(r)
                    }
                    status={STATUS[statusOf(r)].badge}
                    edited={r.overrideStatus !== null || pending[r.studentId] !== undefined}
                    onSelect={{
                      label: `Change attendance for ${r.name}`,
                      run: () => {
                        setEditing(r);
                      },
                    }}
                  />
                ))}
              </Card>
              <p className="text-body-sm text-ink-muted">
                Tap a student to change their status; a reason is required.
              </p>
            </>
          )}
          {/* Google Meet classes: who was online, to confirm (integration slice). */}
          {meeting.data !== undefined && meeting.data.providerStatus !== null ? (
            <MeetParticipants meetingId={meetingId} />
          ) : null}
        </div>
        {/* Desktop: the class's facts beside the list (§11.8). */}
        <aside aria-label="About this class" className="space-y-3">
          <Link
            to="/teach/meetings/$meetingId/roll-call"
            params={{ meetingId }}
            className={buttonClass({ variant: "secondary", block: true })}
          >
            Roll call
          </Link>
          {meeting.data ? (
            <a
              href={`/api/v1/reports/attendance?offeringId=${meeting.data.courseOfferingId}&format=csv`}
              className={buttonClass({ variant: "secondary", block: true })}
            >
              Course attendance (CSV)
            </a>
          ) : null}
        </aside>
      </div>
      <OverrideSheet
        meetingId={meetingId}
        record={editing}
        onClose={() => {
          setEditing(null);
        }}
      />
    </div>
  );
}
