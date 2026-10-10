import type { ClassMeeting, meetings } from "@glim/contracts";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { api, ApiError } from "../../api/client";
import { describeError } from "../../api/error-copy";
import { cn } from "../../design/cn";
import { Badge, type BadgeStatus } from "../ui/badge";
import { Button } from "../ui/button";
import { Time } from "../time";

const BADGE: Record<ClassMeeting["state"], BadgeStatus> = {
  SCHEDULED: "scheduled",
  OPEN: "open",
  LIVE: "live",
  ENDED: "ended",
  CANCELLED: "cancelled",
  NO_SHOW: "no_show",
};

/**
 * Joins online: asks the server for the link (given only inside the join window, and every
 * attempt is logged), then goes to it. The page navigates rather than opening a tab: a tab opened
 * after the request returns is no longer part of the tap, and browsers block it
 * (docs/implementation-notes.md). On phones the Meet link opens the Meet app.
 */
function JoinAction({ meeting }: { meeting: ClassMeeting }) {
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<{ text: string; linkGoogle: boolean } | null>(null);
  const live = meeting.state === "LIVE";
  return (
    <div className="space-y-2 pt-2">
      <Button
        variant={live ? "live" : "primary"}
        block
        loading={busy}
        onClick={() => {
          setBusy(true);
          setProblem(null);
          api<typeof meetings.joinClassMeeting>("POST", "/class-meetings/:id/join", {
            params: { id: meeting.id },
          })
            .then((joined) => {
              setOpening(true);
              window.location.assign(joined.onlineLink);
            })
            .catch((error: unknown) => {
              const copy = describeError(error);
              setProblem({
                text: copy.body ? `${copy.title}. ${copy.body}` : copy.title,
                linkGoogle: error instanceof ApiError && error.code === "GOOGLE_ACCOUNT_REQUIRED",
              });
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {live ? "Join live class" : "Join class"}
      </Button>
      <div role="status" className="text-body-sm">
        {opening ? <p className="text-ink-muted">Opening Google Meet…</p> : null}
        {problem ? (
          <p className="text-warning">
            {problem.text}{" "}
            {problem.linkGoogle ? (
              <Link to="/profile" className="font-semibold underline">
                Link Google account
              </Link>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One Class Meeting (docs/ui-design-handoff.md §9.14): its state as a word, course, title, time
 * (the viewer's zone, Lagos alongside when it differs) and where it happens, with the one action
 * that fits. A live class is the only thing in the live colour (UI-4). Students get Join; people
 * who manage the meeting pass their own `actions`. The Meet link itself is never shown.
 */
export function ClassMeetingCard({
  meeting,
  actions,
}: {
  meeting: ClassMeeting;
  /** For Lecturers: their own buttons instead of Join. */
  actions?: ReactNode;
}) {
  const live = meeting.state === "LIVE";
  const cancelled = meeting.state === "CANCELLED";
  const joinable =
    (meeting.state === "OPEN" || live) && meeting.hasOnlineLink && actions === undefined;
  const where = [
    meeting.room ? `On campus: ${meeting.room.name}` : null,
    meeting.hasOnlineLink ? "Online" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article
      aria-label={`${meeting.courseCode} ${meeting.title}`}
      className={cn(
        "space-y-2 rounded-md border p-4",
        live ? "border-live bg-live-soft" : "border-line bg-surface-raised",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Badge status={BADGE[meeting.state]} />
        <span className="font-mono text-meta text-ink-muted">{meeting.courseCode}</span>
      </div>
      <h3 className={cn("line-clamp-2 text-heading", cancelled && "text-ink-muted line-through")}>
        {meeting.title}
      </h3>
      <p className="text-body-sm text-ink-muted">
        <Time value={meeting.scheduledStart} withDate={false} /> –{" "}
        <Time value={meeting.scheduledEnd} withDate={false} />
        {where ? ` · ${where}` : null}
      </p>
      {joinable ? <JoinAction meeting={meeting} /> : null}
      {actions && !cancelled ? <div className="pt-2">{actions}</div> : null}
    </article>
  );
}
