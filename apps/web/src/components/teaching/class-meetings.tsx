import type { calendar, ClassMeeting, meetings, Offering, ScheduleWarning } from "@glim/contracts";
import { zonedToInstant } from "@glim/shared/time";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useState, type SubmitEvent } from "react";
import { api, ApiError } from "../../api/client";
import { describeError } from "../../api/error-copy";
import { meQuery } from "../../api/session";
import { Icon } from "../../design/icons";
import { formText } from "../form";
import { myScheduleQuery } from "../meetings";
import { Time } from "../time";
import { Banner } from "../ui/banner";
import { Button, buttonClass } from "../ui/button";
import { Checkbox } from "../ui/choice";
import { Sheet } from "../ui/dialog";
import { Select, TextField } from "../ui/field";
import { iconButtonClass } from "../ui/icon-button";
import { Menu } from "../ui/menu";

const roomsQuery = queryOptions({
  queryKey: ["rooms"],
  queryFn: ({ signal }) => api<typeof calendar.listRooms>("GET", "/rooms", { signal }),
});

/** Every list that shows Class Meetings, refreshed after a change. */
async function refreshMeetings(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: myScheduleQuery.queryKey }),
    queryClient.invalidateQueries({ queryKey: ["class-meetings"] }),
  ]);
}

interface Problem {
  title: string;
  body?: string | undefined;
  fieldErrors: Record<string, string>;
  conflicts: { meetingId: string; title: string; scheduledStart: string }[];
}

/** What went wrong, for a form: §12.3 copy, field errors and the Class Meetings in the way. */
function problemOf(error: unknown): Problem {
  if (error instanceof RangeError)
    return { title: "Enter a date and times.", fieldErrors: {}, conflicts: [] };
  const copy = describeError(error);
  return error instanceof ApiError
    ? {
        ...copy,
        fieldErrors: error.fieldErrors,
        conflicts: error.envelope?.error.conflicts ?? [],
      }
    : { ...copy, fieldErrors: {}, conflicts: [] };
}

function ProblemBanner({ problem }: { problem: Problem | null }) {
  if (problem === null) return null;
  return (
    <Banner tone="danger" title={problem.title}>
      {problem.body}
      {problem.conflicts.length > 0 ? (
        <ul className="mt-1 list-disc pl-5">
          {problem.conflicts.map((c) => (
            <li key={c.meetingId}>
              {c.title}, <Time value={c.scheduledStart} />
            </li>
          ))}
        </ul>
      ) : null}
    </Banner>
  );
}

/** The zone times are typed in: the institution's (TRD §5.1), named in the date's label. */
function useInstitutionZone(): string {
  const me = useQuery(meQuery);
  return me.data?.institution.timezone ?? "Africa/Lagos";
}

const zoneName = (zone: string) => zone.split("/").pop()?.replaceAll("_", " ") ?? zone;

const WEEKDAYS = [
  ["MO", "Mon"],
  ["TU", "Tue"],
  ["WE", "Wed"],
  ["TH", "Thu"],
  ["FR", "Fri"],
  ["SA", "Sat"],
  ["SU", "Sun"],
] as const;

/**
 * Schedules one Class Meeting or a weekly series (TRD §11, handoff §11.11 "session create",
 * composed). Times are typed in the institution's timezone; the Room and the Google Meet link
 * are optional. Conflicts come back inline; a clash for students is a warning after saving.
 */
export function ScheduleMeetingSheet({
  offering,
  open,
  onOpenChange,
}: {
  offering: Offering;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const rooms = useQuery({ ...roomsQuery, enabled: open });
  const zone = useInstitutionZone();
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [warnings, setWarnings] = useState<ScheduleWarning[] | null>(null);
  const [repeat, setRepeat] = useState(false);

  const close = (next: boolean) => {
    if (!next) {
      setProblem(null);
      setWarnings(null);
      setRepeat(false);
    }
    onOpenChange(next);
  };

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = formText(form, "date");
    setBusy(true);
    setProblem(null);
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
      await refreshMeetings(queryClient);
      if (created.warnings.length > 0) setWarnings(created.warnings);
      else close(false);
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      title="Schedule a Class Meeting"
      description={`${offering.courseCode} · ${offering.title}`}
      footer={
        warnings === null ? (
          <Button type="submit" form={formId} variant="primary" block loading={busy}>
            Schedule
          </Button>
        ) : (
          <Button
            variant="primary"
            block
            onClick={() => {
              close(false);
            }}
          >
            Done
          </Button>
        )
      }
    >
      {warnings !== null ? (
        <div className="space-y-3">
          <Banner tone="success" title="The Class Meeting is scheduled." />
          {warnings.map((w) => (
            <Banner key={w.code} tone="warning">
              {w.count === 1 ? "1 student has" : `${String(w.count)} students have`} another Class
              Meeting at that time.
            </Banner>
          ))}
        </div>
      ) : (
        <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-4">
          <ProblemBanner problem={problem} />
          <TextField
            name="title"
            label={repeat ? "Title (use {n} for the number, e.g. Week {n})" : "Title"}
            required
            maxLength={200}
            error={problem?.fieldErrors.title ?? problem?.fieldErrors.titleTemplate}
          />
          <TextField name="date" type="date" label={`Date (${zoneName(zone)} time)`} required />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              name="start"
              type="time"
              label="Starts"
              required
              error={problem?.fieldErrors.scheduledStart}
            />
            <TextField
              name="end"
              type="time"
              label="Ends"
              required
              error={problem?.fieldErrors.scheduledEnd}
            />
          </div>
          <Select name="roomId" label="Room" defaultValue="">
            <option value="">Online only</option>
            {rooms.data?.items
              .filter((r) => r.status === "ACTIVE")
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.code})
                </option>
              ))}
          </Select>
          <TextField
            name="onlineLink"
            type="url"
            label="Google Meet link"
            optional
            placeholder="https://meet.google.com/abc-defg-hij"
            error={problem?.fieldErrors.onlineLink}
          />
          <Checkbox
            label="Repeat weekly"
            checked={repeat}
            onChange={(e) => {
              setRepeat(e.currentTarget.checked);
            }}
          />
          {repeat ? (
            <fieldset className="space-y-3">
              <legend className="text-label">On</legend>
              <div className="flex flex-wrap gap-x-4">
                {WEEKDAYS.map(([code, label]) => (
                  <Checkbox key={code} name="weekday" value={code} label={label} />
                ))}
              </div>
              <TextField
                name="untilOn"
                type="date"
                label="Until"
                optional
                error={problem?.fieldErrors.untilOn}
              />
            </fieldset>
          ) : null}
        </form>
      )}
    </Sheet>
  );
}

/** Reschedule (`move`) or cancel one Class Meeting or, in a series, it and the later ones. */
function ChangeMeetingSheet({
  meeting,
  mode,
  onClose,
}: {
  meeting: ClassMeeting;
  mode: "move" | "cancel" | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const zone = useInstitutionZone();
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
      await refreshMeetings(queryClient);
      onClose();
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  }

  const cancelling = mode === "cancel";
  return (
    <Sheet
      open={mode !== null}
      onOpenChange={(next) => {
        if (!next) {
          setProblem(null);
          onClose();
        }
      }}
      title={cancelling ? "Cancel this class?" : "Move this class"}
      description={
        cancelling
          ? `${meeting.title}. Students will see that it is cancelled, with your reason.`
          : `${meeting.title}. Students will see the new time.`
      }
      footer={
        <Button
          type="submit"
          form={formId}
          variant={cancelling ? "danger" : "primary"}
          block
          loading={busy}
        >
          {cancelling ? "Cancel class" : "Move class"}
        </Button>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-4">
        <ProblemBanner problem={problem} />
        {cancelling ? (
          <TextField
            name="reason"
            label="Reason (students will see it)"
            required
            minLength={3}
            error={problem?.fieldErrors.reason}
          />
        ) : (
          <>
            <TextField
              name="date"
              type="date"
              label={`New date (${zoneName(zone)} time)`}
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                name="start"
                type="time"
                label="Starts"
                required
                error={problem?.fieldErrors.scheduledStart}
              />
              <TextField
                name="end"
                type="time"
                label="Ends"
                required
                error={problem?.fieldErrors.scheduledEnd}
              />
            </div>
          </>
        )}
        {meeting.seriesId === null ? null : (
          <Select name="scope" label="Which Class Meetings?" defaultValue="THIS_ONLY">
            <option value="THIS_ONLY">Just this one</option>
            <option value="ALL_FUTURE">This one and the later ones in the series</option>
          </Select>
        )}
      </form>
    </Sheet>
  );
}

/**
 * A Lecturer's actions on a Class Meeting card (§9.14, role Lecturer): "Start class" while it
 * can start; once started, the room instructions, the recording notice, Google Meet, roll call
 * and End class; otherwise roll call and a menu for attendance, reschedule and cancel.
 */
export function LecturerMeetingActions({ meeting }: { meeting: ClassMeeting }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [change, setChange] = useState<"move" | "cancel" | null>(null);
  const [started, setStarted] = useState<{
    onlineLink: string | null;
    recordingNotice: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

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
      await refreshMeetings(queryClient);
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  }

  const rollCall = (
    <Link
      to="/teach/meetings/$meetingId/roll-call"
      params={{ meetingId: meeting.id }}
      className={buttonClass({ variant: "secondary", size: "sm" })}
    >
      Roll call
    </Link>
  );

  // The Start screen (TRD §11.5): what to do in the room, the recording notice, the link.
  if (started !== null || meeting.state === "LIVE") {
    const link = started?.onlineLink ?? meeting.onlineLink;
    return (
      <div className="space-y-3">
        <ProblemBanner problem={problem} />
        <Banner tone="info" title="The class has started.">
          Open this on the room computer, signed in as you, so online students can see and hear the
          room. Recording starts when you join.
        </Banner>
        {started?.recordingNotice ? (
          <p className="text-body-sm text-ink">{started.recordingNotice}</p>
        ) : null}
        {link ? (
          <a href={link} rel="noreferrer" className={buttonClass({ variant: "live", block: true })}>
            Open Google Meet
          </a>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {rollCall}
          <Button size="sm" variant="danger" loading={busy} onClick={() => void lifecycle("end")}>
            End class
          </Button>
        </div>
      </div>
    );
  }

  const canStart = meeting.state === "SCHEDULED" || meeting.state === "OPEN";
  return (
    <div className="space-y-3">
      <ProblemBanner problem={problem} />
      {canStart ? (
        <Button variant="primary" block loading={busy} onClick={() => void lifecycle("start")}>
          Start class
        </Button>
      ) : null}
      <div className="flex items-center gap-2">
        {rollCall}
        <span className="flex-1" />
        <Menu
          trigger={
            <button
              type="button"
              aria-label={`More actions for ${meeting.title}`}
              className={iconButtonClass}
            >
              <Icon name="menu" />
            </button>
          }
          items={[
            {
              label: "Attendance",
              icon: "users",
              onSelect: () => {
                void navigate({
                  to: "/teach/meetings/$meetingId/attendance",
                  params: { meetingId: meeting.id },
                });
              },
            },
            ...(meeting.state === "ENDED" || meeting.state === "NO_SHOW"
              ? []
              : [
                  {
                    label: "Reschedule",
                    icon: "calendar" as const,
                    onSelect: () => {
                      setChange("move");
                    },
                  },
                  {
                    label: "Cancel class",
                    danger: true,
                    onSelect: () => {
                      setChange("cancel");
                    },
                  },
                ]),
          ]}
        />
      </div>
      <ChangeMeetingSheet
        meeting={meeting}
        mode={change}
        onClose={() => {
          setChange(null);
        }}
      />
    </div>
  );
}
