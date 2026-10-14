import type { ClassMeeting, meetings } from "@glim/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { api, ApiError } from "../../api/client";
import { errorText } from "../../api/error-copy";
import { Icon } from "../../design/icons";
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

/** "in 3 h 20 min" when a time is less than a day away (§10.6), else null. */
function startsIn(iso: string, now: Date): string | null {
  const minutes = Math.floor((new Date(iso).getTime() - now.getTime()) / 60_000);
  if (minutes < 0 || minutes >= 24 * 60) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${String(m)} min` : `${String(h)} h ${String(m)} min`;
}

/**
 * Joins online: asks the server for the link (given only inside the join window, and every
 * attempt is logged), then goes to it. The page navigates rather than opening a tab: a tab opened
 * after the request returns is no longer part of the tap, and browsers block it
 * (docs/implementation-notes.md). On phones the Meet link opens the Meet app.
 */
function JoinAction({ meeting }: { meeting: ClassMeeting }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<{ text: string; linkGoogle: boolean } | null>(null);
  const [phone, setPhone] = useState<
    { region: string; phone: string; pin: string }[] | "none" | null
  >(null);
  const live = meeting.state === "LIVE";
  const join = () =>
    api<typeof meetings.joinClassMeeting>("POST", "/class-meetings/:id/join", {
      params: { id: meeting.id },
    });
  const failed = (error: unknown) => {
    setProblem({
      text: errorText(error),
      linkGoogle: error instanceof ApiError && error.code === "GOOGLE_ACCOUNT_REQUIRED",
    });
    // The class closed (or isn't open yet): fetch its real state for the card.
    if (error instanceof ApiError && error.code === "JOIN_WINDOW_CLOSED") {
      void queryClient.invalidateQueries({ queryKey: ["me", "schedule"] });
      void queryClient.invalidateQueries({ queryKey: ["class-meetings"] });
    }
  };
  return (
    <div className="space-y-2 pt-2">
      <Button
        variant={live ? "live" : "primary"}
        block
        loading={busy}
        onClick={() => {
          setBusy(true);
          setProblem(null);
          join()
            .then((joined) => {
              setOpening(true);
              window.location.assign(joined.onlineLink);
            })
            .catch(failed)
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {live ? "Join live class" : "Join class"}
      </Button>
      {/* Low data (§11.5): Google Meet's dial-in numbers, when Google gives them. */}
      {meeting.providerStatus !== null && phone === null ? (
        <Button
          variant="quiet"
          size="sm"
          block
          onClick={() => {
            setProblem(null);
            join()
              .then((joined) => {
                setPhone(joined.dialIn === null ? "none" : joined.dialIn.numbers);
              })
              .catch(failed);
          }}
        >
          Join by phone instead
        </Button>
      ) : null}
      {phone === "none" ? (
        <p className="text-body-sm text-ink-muted">
          Joining by phone isn't available for this class.
        </p>
      ) : phone !== null ? (
        <ul aria-label="Dial-in numbers" className="space-y-1 text-body-sm">
          {phone.map((n) => (
            <li key={n.phone}>
              {n.region}:{" "}
              <a
                href={`tel:${n.phone.replaceAll(" ", "")},,${n.pin}#`}
                className="font-semibold underline"
              >
                {n.phone}
              </a>
              , PIN {n.pin}#
            </li>
          ))}
        </ul>
      ) : null}
      <div role="status" className="text-body-sm">
        {opening ? <p className="text-ink-muted">Opening Google Meet…</p> : null}
      </div>
      <div role="alert" className="text-body-sm">
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
  const soon = startsIn(meeting.scheduledStart, new Date());
  const cancelled = meeting.state === "CANCELLED";
  // A Google Meet class can be joined while its link is being prepared: the server says so.
  const online = meeting.hasOnlineLink || meeting.providerStatus !== null;
  const joinable = (meeting.state === "OPEN" || live) && online && actions === undefined;
  const where = [meeting.room ? `On campus: ${meeting.room.name}` : null, online ? "Online" : null]
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
      {meeting.state === "SCHEDULED" && soon ? (
        <p className="flex items-center gap-1 text-label text-info">
          <Icon name="clock" size={16} />
          Starts in {soon}
        </p>
      ) : null}
      {meeting.state === "ENDED" && meeting.recordingMode !== "OFF" ? (
        <p className="text-body-sm text-ink-muted">Recording expected</p>
      ) : null}
      {joinable ? <JoinAction meeting={meeting} /> : null}
      {actions && !cancelled ? <div className="pt-2">{actions}</div> : null}
    </article>
  );
}
