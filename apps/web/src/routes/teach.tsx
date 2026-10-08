import type {
  calendar,
  meetings,
  Offering,
  offerings,
  ScheduleWarning,
  video,
} from "@glim/contracts";
import { zonedToInstant } from "@glim/shared/time";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, ApiError } from "../api/client";
import { meQuery } from "../api/session";
import { Alert, Field, SubmitButton, formText } from "../components/form";
import { myScheduleQuery, UpcomingMeetings, type ScheduleItem } from "../components/meetings";
import { Time } from "../components/time";

const myOfferingsQuery = queryOptions({
  queryKey: ["offerings", "mine"],
  queryFn: ({ signal }) =>
    api<typeof offerings.listOfferings>("GET", "/course-offerings", { signal }),
});

const roomsQuery = queryOptions({
  queryKey: ["rooms"],
  queryFn: ({ signal }) => api<typeof calendar.listRooms>("GET", "/rooms", { signal }),
});

const ROLE_LABELS: Record<string, string> = {
  PRIMARY: "Primary Lecturer",
  CO_LECTURER: "Co-lecturer",
  ASSISTANT: "Assistant",
  GUEST_LECTURER: "Guest lecturer",
};

interface Problem {
  message: string;
  fieldErrors: Record<string, string>;
  conflicts: { meetingId: string; title: string; scheduledStart: string }[];
}

const WEEKDAYS = [
  ["MO", "Mon"],
  ["TU", "Tue"],
  ["WE", "Wed"],
  ["TH", "Thu"],
  ["FR", "Fri"],
  ["SA", "Sat"],
  ["SU", "Sun"],
] as const;

/** What went wrong, for the form: the API's message, field errors and the meetings in the way. */
function problemOf(error: unknown): Problem {
  if (error instanceof ApiError)
    return {
      message: error.message,
      fieldErrors: error.fieldErrors,
      conflicts: error.envelope?.error.conflicts ?? [],
    };
  if (error instanceof RangeError)
    return { message: "Enter a date and times.", fieldErrors: {}, conflicts: [] };
  return {
    message: "We couldn't reach the server. Check your connection and try again.",
    fieldErrors: {},
    conflicts: [],
  };
}

function ProblemAlert({ problem }: { problem: Problem | null }) {
  if (problem === null) return null;
  return (
    <Alert tone="error">
      {problem.message}
      {problem.conflicts.length > 0 ? (
        <ul className="mt-1 list-disc pl-5">
          {problem.conflicts.map((c) => (
            <li key={c.meetingId}>
              {c.title}, <Time value={c.scheduledStart} />
            </li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}

/**
 * Schedules one Class Meeting (TRD §11, v1 spec). Times are typed in the institution's timezone;
 * the Room is optional (online only) and so is the Google Meet link.
 */
function ScheduleMeetingForm({ offering, onDone }: { offering: Offering; onDone: () => void }) {
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);
  const rooms = useQuery(roomsQuery);
  const zone = me.data?.institution.timezone ?? "Africa/Lagos";
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [warnings, setWarnings] = useState<ScheduleWarning[]>([]);
  const [repeat, setRepeat] = useState(false);

  async function submit(element: HTMLFormElement) {
    const form = new FormData(element);
    const date = formText(form, "date");
    setBusy(true);
    setProblem(null);
    setWarnings([]);
    try {
      const roomId = formText(form, "roomId");
      const link = formText(form, "onlineLink");
      const start = zonedToInstant(date, formText(form, "start"), zone);
      const end = zonedToInstant(date, formText(form, "end"), zone);
      const common = {
        roomId: roomId === "" ? null : roomId,
        onlineLink: link === "" ? null : link,
      };
      const headers = { "idempotency-key": crypto.randomUUID() };
      const created = repeat
        ? await api<typeof meetings.createClassMeetingSeries>(
            "POST",
            "/course-offerings/:id/class-meeting-series",
            {
              params: { id: offering.id },
              headers,
              body: {
                ...common,
                titleTemplate: formText(form, "title"),
                weekdays: form.getAll("weekday") as (typeof WEEKDAYS)[number][0][],
                startsOn: date,
                untilOn: formText(form, "untilOn") || null,
                startTime: formText(form, "start"),
                durationMinutes: Math.round((Date.parse(end) - Date.parse(start)) / 60_000),
              },
            },
          )
        : await api<typeof meetings.createClassMeeting>(
            "POST",
            "/course-offerings/:id/class-meetings",
            {
              params: { id: offering.id },
              headers,
              body: {
                ...common,
                title: formText(form, "title"),
                scheduledStart: start,
                scheduledEnd: end,
              },
            },
          );
      await queryClient.invalidateQueries({ queryKey: myScheduleQuery.queryKey });
      if (created.warnings.length > 0) setWarnings(created.warnings);
      else onDone();
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  }

  if (warnings.length > 0)
    return (
      <div className="space-y-2">
        <Alert tone="success">The Class Meeting is scheduled.</Alert>
        {warnings.map((w) => (
          <p key={w.code} className="text-sm text-amber-800">
            {w.count === 1 ? "1 student has" : `${String(w.count)} students have`} another Class
            Meeting at that time.
          </p>
        ))}
        <button type="button" className="text-sm text-brand underline" onClick={onDone}>
          Done
        </button>
      </div>
    );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget);
      }}
      className="space-y-3"
    >
      <ProblemAlert problem={problem} />
      <Field
        id={`title-${offering.id}`}
        name="title"
        label={repeat ? "Title (use {n} for the number, e.g. Week {n})" : "Title"}
        required
        maxLength={200}
        error={problem?.fieldErrors.title}
      />
      <Field
        id={`date-${offering.id}`}
        name="date"
        type="date"
        label={`Date (${zone.split("/").pop()?.replaceAll("_", " ") ?? zone} time)`}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          id={`start-${offering.id}`}
          name="start"
          type="time"
          label="Starts"
          required
          error={problem?.fieldErrors.scheduledStart}
        />
        <Field
          id={`end-${offering.id}`}
          name="end"
          type="time"
          label="Ends"
          required
          error={problem?.fieldErrors.scheduledEnd}
        />
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-slate-700">Room</span>
        <select
          name="roomId"
          className="block w-full rounded border border-slate-300 bg-white px-2 py-2"
          defaultValue=""
        >
          <option value="">Online only</option>
          {rooms.data?.items
            .filter((r) => r.status === "ACTIVE")
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.code})
              </option>
            ))}
        </select>
      </label>
      <Field
        id={`link-${offering.id}`}
        name="onlineLink"
        type="url"
        label="Google Meet link (optional)"
        placeholder="https://meet.google.com/abc-defg-hij"
        error={problem?.fieldErrors.onlineLink}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={repeat}
          onChange={(e) => {
            setRepeat(e.currentTarget.checked);
          }}
        />
        Repeat weekly
      </label>
      {repeat ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">On</legend>
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map(([code, label]) => (
              <label key={code} className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="weekday" value={code} />
                {label}
              </label>
            ))}
          </div>
          <Field
            id={`until-${offering.id}`}
            name="untilOn"
            type="date"
            label="Until (optional)"
            error={problem?.fieldErrors.untilOn}
          />
        </fieldset>
      ) : null}
      <SubmitButton busy={busy}>Schedule</SubmitButton>
    </form>
  );
}

/** Reschedule or cancel one of my Class Meetings (or, for a series, it and the later ones). */
function MeetingActions({ meeting }: { meeting: ScheduleItem }) {
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);
  const zone = me.data?.institution.timezone ?? "Africa/Lagos";
  const [mode, setMode] = useState<"idle" | "move" | "cancel">("idle");
  const [started, setStarted] = useState<{
    onlineLink: string | null;
    recordingNotice: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: myScheduleQuery.queryKey });
    setMode("idle");
  };

  async function send(element: HTMLFormElement) {
    const form = new FormData(element);
    const scope =
      meeting.seriesId === null
        ? undefined
        : (formText(form, "scope") as "THIS_ONLY" | "ALL_FUTURE");
    setBusy(true);
    setProblem(null);
    try {
      if (mode === "cancel") {
        await api<typeof meetings.cancelClassMeeting>("POST", "/class-meetings/:id/cancel", {
          params: { id: meeting.id },
          body: { reason: formText(form, "reason"), ...(scope ? { scope } : {}) },
        });
      } else {
        const date = formText(form, "date");
        await api<typeof meetings.updateClassMeeting>("PATCH", "/class-meetings/:id", {
          params: { id: meeting.id },
          headers: { "if-match": `"${String(meeting.version)}"` },
          body: {
            scheduledStart: zonedToInstant(date, formText(form, "start"), zone),
            scheduledEnd: zonedToInstant(date, formText(form, "end"), zone),
            ...(scope ? { scope } : {}),
          },
        });
      }
      await done();
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function lifecycle(action: "start" | "end") {
    setBusy(true);
    setProblem(null);
    try {
      if (action === "start") {
        const result = await api<typeof meetings.startClassMeeting>(
          "POST",
          "/class-meetings/:id/start",
          { params: { id: meeting.id } },
        );
        setStarted({ onlineLink: result.onlineLink, recordingNotice: result.recordingNotice });
      } else {
        await api<typeof meetings.endClassMeeting>("POST", "/class-meetings/:id/end", {
          params: { id: meeting.id },
        });
        setStarted(null);
      }
      await queryClient.invalidateQueries({ queryKey: myScheduleQuery.queryKey });
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  }

  // The Start screen (TRD §11.5): what to do in the room, the recording notice, the link.
  if (started !== null || meeting.state === "LIVE")
    return (
      <div className="space-y-2 border-t border-slate-100 pt-2 text-sm">
        <ProblemAlert problem={problem} />
        <p className="font-medium">The class has started.</p>
        <p>
          Open this on the room computer, signed in as you, so online students can see and hear the
          room. Recording starts when you join.
        </p>
        {started?.recordingNotice ? (
          <p className="rounded bg-amber-50 p-2 text-amber-900">{started.recordingNotice}</p>
        ) : null}
        {(started?.onlineLink ?? meeting.onlineLink) ? (
          <a
            href={started?.onlineLink ?? meeting.onlineLink ?? ""}
            className="inline-block rounded bg-brand px-3 py-1.5 font-medium text-white"
            rel="noreferrer"
          >
            Open Google Meet
          </a>
        ) : null}
        <Link
          to="/teach/meetings/$meetingId/roll-call"
          params={{ meetingId: meeting.id }}
          className="ml-4 text-brand underline"
        >
          Roll call
        </Link>
        <button
          type="button"
          disabled={busy}
          className="ml-4 text-red-700 underline"
          onClick={() => void lifecycle("end")}
        >
          End class
        </button>
      </div>
    );

  if (mode === "idle")
    return (
      <div className="flex flex-wrap gap-4 text-sm">
        <ProblemAlert problem={problem} />
        {meeting.state === "SCHEDULED" || meeting.state === "OPEN" ? (
          <button
            type="button"
            disabled={busy}
            className="font-medium text-brand underline"
            onClick={() => void lifecycle("start")}
          >
            Start class
          </button>
        ) : null}
        <Link
          to="/teach/meetings/$meetingId/roll-call"
          params={{ meetingId: meeting.id }}
          className="text-brand underline"
        >
          Roll call
        </Link>
        <button
          type="button"
          className="text-brand underline"
          onClick={() => {
            setMode("move");
          }}
        >
          Reschedule
        </button>
        <button
          type="button"
          className="text-red-700 underline"
          onClick={() => {
            setMode("cancel");
          }}
        >
          Cancel class
        </button>
      </div>
    );
  return (
    <form
      className="space-y-2 border-t border-slate-100 pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        void send(event.currentTarget);
      }}
    >
      <ProblemAlert problem={problem} />
      {mode === "move" ? (
        <>
          <Field id={`mv-date-${meeting.id}`} name="date" type="date" label="New date" required />
          <div className="grid grid-cols-2 gap-3">
            <Field id={`mv-start-${meeting.id}`} name="start" type="time" label="Starts" required />
            <Field id={`mv-end-${meeting.id}`} name="end" type="time" label="Ends" required />
          </div>
        </>
      ) : (
        <Field
          id={`cx-reason-${meeting.id}`}
          name="reason"
          label="Reason (students will see it)"
          required
          minLength={3}
        />
      )}
      {meeting.seriesId === null ? null : (
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Which Class Meetings?</span>
          <select
            name="scope"
            defaultValue="THIS_ONLY"
            className="block w-full rounded border border-slate-300 bg-white px-2 py-2"
          >
            <option value="THIS_ONLY">Just this one</option>
            <option value="ALL_FUTURE">This one and the later ones in the series</option>
          </select>
        </label>
      )}
      <div className="flex items-center gap-4">
        <SubmitButton busy={busy}>{mode === "move" ? "Move class" : "Cancel class"}</SubmitButton>
        <button
          type="button"
          className="text-sm underline"
          onClick={() => {
            setMode("idle");
            setProblem(null);
          }}
        >
          Back
        </button>
      </div>
    </form>
  );
}

/** All of an offering's Class Meetings, with links to roll call and attendance. */
function OfferingMeetings({ offeringId }: { offeringId: string }) {
  const list = useQuery({
    queryKey: ["offering-meetings", offeringId],
    queryFn: ({ signal }) =>
      api<typeof meetings.listClassMeetings>("GET", "/course-offerings/:id/class-meetings", {
        params: { id: offeringId },
        signal,
      }),
  });
  if (list.isPending) return <p className="text-sm text-slate-600">Loading…</p>;
  if (list.isError) return null;
  if (list.data.items.length === 0)
    return <p className="text-sm text-slate-600">No Class Meetings yet.</p>;
  return (
    <>
      <a
        href={`/api/v1/reports/attendance?offeringId=${offeringId}&format=csv`}
        className="block text-sm text-brand underline"
      >
        Download attendance (CSV)
      </a>
      <ul className="space-y-1 text-sm">
        {list.data.items.map((m) => (
          <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2">
            <span className={m.state === "CANCELLED" ? "text-slate-500 line-through" : ""}>
              {m.title}, <Time value={m.scheduledStart} />
            </span>
            {m.state === "CANCELLED" ? null : (
              <span className="flex gap-3">
                <Link
                  to="/teach/meetings/$meetingId/roll-call"
                  params={{ meetingId: m.id }}
                  className="text-brand underline"
                >
                  Roll call
                </Link>
                <Link
                  to="/teach/meetings/$meetingId/attendance"
                  params={{ meetingId: m.id }}
                  className="text-brand underline"
                >
                  Attendance
                </Link>
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * An offering's recordings (TRD §13.3, §13.6): add by YouTube link, publish or hide, and move up
 * or down. Only Primary and Co-lecturers (and admins) can change them; the server says so.
 */
function OfferingRecordings({ offeringId }: { offeringId: string }) {
  const queryClient = useQueryClient();
  const key = ["videos", offeringId];
  const list = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api<typeof video.listVideos>("GET", "/course-offerings/:id/videos", {
        params: { id: offeringId },
        signal,
      }),
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: key });
      return true;
    } catch (error) {
      setProblem(problemOf(error));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const items = list.data?.items ?? [];
  const move = (index: number, by: number) => {
    const ids = items.map((v) => v.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(index + by, 0, moved);
    void run(() =>
      api<typeof video.reorderVideos>("PUT", "/course-offerings/:id/videos/order", {
        params: { id: offeringId },
        body: { videoIds: ids },
      }),
    );
  };
  return (
    <div className="space-y-2 text-sm">
      <ProblemAlert problem={problem} />
      {items.length === 0 ? <p className="text-slate-600">No recordings yet.</p> : null}
      <ul className="space-y-1">
        {items.map((v, index) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {v.title}{" "}
              <span className="text-slate-500">
                ({v.status === "PUBLISHED" ? "published" : v.status.toLowerCase()})
              </span>
            </span>
            <span className="flex gap-3">
              <button
                type="button"
                disabled={busy || index === 0}
                aria-label={`Move ${v.title} up`}
                onClick={() => {
                  move(index, -1);
                }}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={busy || index === items.length - 1}
                aria-label={`Move ${v.title} down`}
                onClick={() => {
                  move(index, 1);
                }}
              >
                ↓
              </button>
              {v.status === "PUBLISHED" || v.status === "UNPUBLISHED" ? (
                <button
                  type="button"
                  disabled={busy}
                  className="text-brand underline"
                  onClick={() =>
                    void run(() =>
                      v.status === "PUBLISHED"
                        ? api<typeof video.unpublishVideo>("POST", "/videos/:id/unpublish", {
                            params: { id: v.id },
                          })
                        : api<typeof video.publishVideo>("POST", "/videos/:id/publish", {
                            params: { id: v.id },
                            headers: { "idempotency-key": crypto.randomUUID() },
                          }),
                    )
                  }
                >
                  {v.status === "PUBLISHED" ? "Hide" : "Publish"}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <form
        className="space-y-2 border-t border-slate-100 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          const element = event.currentTarget;
          const form = new FormData(element);
          const title = formText(form, "title");
          void run(() =>
            api<typeof video.addVideo>("POST", "/course-offerings/:id/videos", {
              params: { id: offeringId },
              headers: { "idempotency-key": crypto.randomUUID() },
              body: { youtubeUrl: formText(form, "youtubeUrl"), ...(title ? { title } : {}) },
            }),
          ).then((added) => {
            if (added) element.reset();
          });
        }}
      >
        <Field
          id={`yt-${offeringId}`}
          name="youtubeUrl"
          type="url"
          label="YouTube link (uploaded as Unlisted to GLIM's channel)"
          required
          error={problem?.fieldErrors.youtubeUrl}
        />
        <Field
          id={`yt-title-${offeringId}`}
          name="title"
          label="Title (optional: taken from YouTube)"
        />
        <SubmitButton busy={busy}>Add recording</SubmitButton>
      </form>
    </div>
  );
}

function OfferingItem({ offering }: { offering: Offering }) {
  const [scheduling, setScheduling] = useState(false);
  const [showMeetings, setShowMeetings] = useState(false);
  const [showRecordings, setShowRecordings] = useState(false);
  return (
    <li className="space-y-2 rounded border border-slate-200 bg-white p-3">
      <div className="font-medium">
        {offering.courseCode} {offering.title}{" "}
        <span className="font-normal text-slate-600">({offering.sectionCode})</span>
      </div>
      <div className="text-sm text-slate-600">
        {offering.semesterName}, {offering.sessionCode} · {offering.status.toLowerCase()}
      </div>
      <div className="text-sm text-slate-600">
        {offering.lecturers
          .map((l) => `${l.lecturerName} (${ROLE_LABELS[l.role] ?? l.role})`)
          .join(", ")}
      </div>
      <button
        type="button"
        className="block text-sm text-brand underline"
        onClick={() => {
          setShowMeetings((v) => !v);
        }}
      >
        {showMeetings ? "Hide Class Meetings" : "Class Meetings"}
      </button>
      {showMeetings ? <OfferingMeetings offeringId={offering.id} /> : null}
      <button
        type="button"
        className="block text-sm text-brand underline"
        onClick={() => {
          setShowRecordings((v) => !v);
        }}
      >
        {showRecordings ? "Hide recordings" : "Recordings"}
      </button>
      {showRecordings ? <OfferingRecordings offeringId={offering.id} /> : null}
      {offering.status === "COMPLETED" || offering.status === "CANCELLED" ? null : scheduling ? (
        <ScheduleMeetingForm
          offering={offering}
          onDone={() => {
            setScheduling(false);
          }}
        />
      ) : (
        <button
          type="button"
          className="text-sm text-brand underline"
          onClick={() => {
            setScheduling(true);
          }}
        >
          Schedule a Class Meeting
        </button>
      )}
    </li>
  );
}

/**
 * A Lecturer's teaching page (TRD §18.2 /teach): their upcoming Class Meetings, and the Course
 * Offerings they're assigned to, where they schedule new meetings.
 */
export function TeachPage() {
  const list = useQuery(myOfferingsQuery);
  if (list.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (list.isError) return <Alert tone="error">{list.error.message}</Alert>;
  return (
    <div className="space-y-6">
      <UpcomingMeetings
        title="My teaching schedule"
        as="LECTURER"
        empty="No Class Meetings in the next two weeks."
        actions={(meeting) => <MeetingActions meeting={meeting} />}
      />
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">My offerings</h2>
        {list.data.items.length === 0 ? (
          <p className="text-slate-600">You aren't assigned to any Course Offerings yet.</p>
        ) : null}
        <ul className="space-y-2">
          {list.data.items.map((o) => (
            <OfferingItem key={o.id} offering={o} />
          ))}
        </ul>
      </section>
    </div>
  );
}
