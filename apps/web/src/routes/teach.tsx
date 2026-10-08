import type { calendar, meetings, Offering, offerings, ScheduleWarning } from "@glim/contracts";
import { zonedToInstant } from "@glim/shared/time";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "../api/client";
import { meQuery } from "../api/session";
import { Alert, Field, SubmitButton, formText } from "../components/form";
import { myScheduleQuery, UpcomingMeetings } from "../components/meetings";
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

  async function submit(element: HTMLFormElement) {
    const form = new FormData(element);
    const date = formText(form, "date");
    setBusy(true);
    setProblem(null);
    setWarnings([]);
    try {
      const roomId = formText(form, "roomId");
      const link = formText(form, "onlineLink");
      const created = await api<typeof meetings.createClassMeeting>(
        "POST",
        "/course-offerings/:id/class-meetings",
        {
          params: { id: offering.id },
          headers: { "idempotency-key": crypto.randomUUID() },
          body: {
            title: formText(form, "title"),
            scheduledStart: zonedToInstant(date, formText(form, "start"), zone),
            scheduledEnd: zonedToInstant(date, formText(form, "end"), zone),
            roomId: roomId === "" ? null : roomId,
            onlineLink: link === "" ? null : link,
          },
        },
      );
      await queryClient.invalidateQueries({ queryKey: myScheduleQuery.queryKey });
      if (created.warnings.length > 0) setWarnings(created.warnings);
      else onDone();
    } catch (error) {
      if (error instanceof ApiError)
        setProblem({
          message: error.message,
          fieldErrors: error.fieldErrors,
          conflicts: error.envelope?.error.conflicts ?? [],
        });
      else if (error instanceof RangeError)
        setProblem({ message: "Enter a date and times.", fieldErrors: {}, conflicts: [] });
      else
        setProblem({
          message: "We couldn't reach the server. Check your connection and try again.",
          fieldErrors: {},
          conflicts: [],
        });
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
      {problem ? (
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
      ) : null}
      <Field
        id={`title-${offering.id}`}
        name="title"
        label="Title"
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
      <SubmitButton busy={busy}>Schedule</SubmitButton>
    </form>
  );
}

function OfferingItem({ offering }: { offering: Offering }) {
  const [scheduling, setScheduling] = useState(false);
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
