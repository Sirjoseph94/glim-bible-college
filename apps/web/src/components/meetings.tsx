import type { ClassMeeting, meetings } from "@glim/contracts";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import { Time } from "./time";

export type ScheduleItem = ClassMeeting & { as: "STUDENT" | "LECTURER" };

/** The signed-in user's Class Meetings for the next two weeks (`GET /me/schedule`). */
export const myScheduleQuery = queryOptions({
  queryKey: ["me", "schedule"],
  queryFn: ({ signal }) => api<typeof meetings.getMySchedule>("GET", "/me/schedule", { signal }),
});

const STATE_LABELS: Partial<Record<ClassMeeting["state"], string>> = {
  OPEN: "Open",
  LIVE: "Live now",
  ENDED: "Ended",
  CANCELLED: "Cancelled",
  NO_SHOW: "Didn't take place",
};

/** One Class Meeting: course, when (viewer's zone, Lagos alongside), where, and how to join. */
export function MeetingCard({
  meeting,
  children,
}: {
  meeting: ClassMeeting;
  /** Actions for people who manage the meeting. */
  children?: ReactNode;
}) {
  const cancelled = meeting.state === "CANCELLED";
  const state = STATE_LABELS[meeting.state];
  return (
    <li className="space-y-1 rounded border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={cancelled ? "font-medium text-slate-500 line-through" : "font-medium"}>
          {meeting.courseCode} · {meeting.title}
        </span>
        {state ? (
          <span
            className={
              cancelled
                ? "rounded bg-red-50 px-2 text-xs text-red-800"
                : "rounded bg-slate-100 px-2 text-xs"
            }
          >
            {state}
          </span>
        ) : null}
      </div>
      <div className="text-sm text-slate-700">
        <Time value={meeting.scheduledStart} /> to{" "}
        <Time value={meeting.scheduledEnd} withDate={false} />
      </div>
      <div className="text-sm text-slate-600">
        {meeting.room ? `In ${meeting.room.name} (${meeting.room.code}) and online` : "Online only"}
        {meeting.onlineLink ? (
          <>
            {" · "}
            <a href={meeting.onlineLink} className="text-brand underline" rel="noreferrer">
              Online link
            </a>
          </>
        ) : meeting.hasOnlineLink ? (
          " · the join link appears shortly before class"
        ) : (
          " · no online link yet"
        )}
      </div>
      {meeting.state === "CANCELLED" ? null : children}
    </li>
  );
}

/**
 * Joins online: asks the server for the link (it's only given inside the join window, and every
 * attempt is logged), then opens it.
 */
export function JoinButton({ meeting }: { meeting: ClassMeeting }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!meeting.hasOnlineLink || meeting.state === "ENDED" || meeting.state === "NO_SHOW")
    return null;
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={busy}
        className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white"
        onClick={() => {
          setBusy(true);
          setMessage(null);
          api<typeof meetings.joinClassMeeting>("POST", "/class-meetings/:id/join", {
            params: { id: meeting.id },
          })
            .then((joined) => {
              window.location.assign(joined.onlineLink);
            })
            .catch((error: unknown) => {
              setMessage(
                error instanceof ApiError
                  ? error.message
                  : "We couldn't reach the server. Check your connection and try again.",
              );
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        Join online
      </button>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
    </div>
  );
}

/** Upcoming Class Meetings from my schedule, optionally only those I teach or attend. */
export function UpcomingMeetings({
  title,
  as,
  empty,
  actions,
}: {
  title: string;
  as?: ScheduleItem["as"];
  empty?: string;
  actions?: (meeting: ScheduleItem) => ReactNode;
}) {
  const schedule = useQuery(myScheduleQuery);
  if (schedule.isPending) return <div className="h-24 animate-pulse rounded bg-slate-200" />;
  if (schedule.isError) return null;
  const items = schedule.data.items.filter((m) => as === undefined || m.as === as);
  if (items.length === 0 && empty === undefined) return null;
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      {items.length === 0 ? <p className="text-sm text-slate-600">{empty}</p> : null}
      <ul className="space-y-2">
        {items.map((m) => (
          <MeetingCard key={`${m.as}-${m.id}`} meeting={m}>
            {actions ? actions(m) : m.as === "STUDENT" ? <JoinButton meeting={m} /> : null}
          </MeetingCard>
        ))}
      </ul>
    </section>
  );
}
