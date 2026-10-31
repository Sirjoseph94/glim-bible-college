import type { calendar, Cohort, CohortSchedule, cohorts } from "@glim/contracts";
import { Link } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { Room } from "@glim/contracts";
import { api } from "../api/client";
import { OfferingStatusBadge } from "../components/app/offering-status";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { formText } from "../components/form";
import { CalendarDate } from "../components/time";
import { Badge } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Sheet } from "../components/ui/dialog";
import { EmptyState } from "../components/ui/empty-state";
import { Select, TextField } from "../components/ui/field";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { useSubmit } from "../components/use-submit";

const roomsQuery = queryOptions({
  queryKey: ["rooms"],
  queryFn: ({ signal }) => api<typeof calendar.listRooms>("GET", "/rooms", { signal }),
});
export const cohortsQuery = queryOptions({
  queryKey: ["cohorts"],
  queryFn: ({ signal }) => api<typeof cohorts.listCohorts>("GET", "/cohorts", { signal }),
});
const scheduleQuery = (id: string) =>
  queryOptions({
    queryKey: ["cohorts", id, "schedule"],
    queryFn: ({ signal }) =>
      api<typeof cohorts.getCohortSchedule>("GET", "/cohorts/:id/schedule", {
        params: { id },
        signal,
      }),
  });

/**
 * Cohort Schedules (ADR-0005): each cohort takes the curriculum's courses one after another, in
 * offerings dated for it. Pick a cohort, plan the courses not yet scheduled end to end, then adjust
 * each offering's dates on its own page.
 */
export function AdminCohortsPage() {
  const list = useQuery(cohortsQuery);
  const [chosen, setChosen] = useState<string | null>(null);
  const cohortId = chosen ?? list.data?.items[0]?.id ?? null;
  return (
    <div className="space-y-8">
      <PageHeader
        title="Cohorts"
        meta="Each cohort takes the curriculum's courses one at a time, on the dates set here."
      />
      {list.isPending ? (
        <SkeletonGroup label="Loading cohorts">
          <Skeleton className="h-40" />
        </SkeletonGroup>
      ) : list.isError ? (
        <LoadFailed what="the cohorts" onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 || cohortId === null ? (
        <EmptyState icon="calendar" title="No cohorts yet">
          A cohort is created when the first applicant of an intake accepts their offer.
        </EmptyState>
      ) : (
        <>
          <Select
            label="Cohort"
            value={cohortId}
            onChange={(event) => {
              setChosen(event.target.value);
            }}
          >
            {list.data.items.map((c) => (
              <option key={c.id} value={c.id}>
                {cohortOption(c)}
              </option>
            ))}
          </Select>
          <Schedule cohortId={cohortId} />
        </>
      )}
    </div>
  );
}

function cohortOption(c: Cohort): string {
  return `${c.code} · starts ${c.startsOn} · ${String(c.activeStudents)} active`;
}

function Schedule({ cohortId }: { cohortId: string }) {
  const schedule = useQuery(scheduleQuery(cohortId));
  const [planning, setPlanning] = useState(false);
  if (schedule.isPending)
    return (
      <SkeletonGroup label="Loading the schedule">
        <Skeleton className="h-40" />
      </SkeletonGroup>
    );
  if (schedule.isError)
    return <LoadFailed what="the schedule" onRetry={() => void schedule.refetch()} />;
  const { cohort, offerings, unscheduled } = schedule.data;
  return (
    <section className="space-y-4" aria-label={`${cohort.code} schedule`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-heading">
          {cohort.name} <span className="text-meta text-ink-muted">from {cohort.startsOn}</span>
        </h2>
        {unscheduled.length > 0 ? (
          <Button
            variant="primary"
            icon="calendar"
            onClick={() => {
              setPlanning(true);
            }}
          >
            Plan {unscheduled.length === 1 ? "1 course" : `${String(unscheduled.length)} courses`}
          </Button>
        ) : null}
      </div>
      {offerings.length === 0 ? (
        <EmptyState icon="calendar" title="Nothing scheduled yet">
          Plan the curriculum's courses for this cohort, then publish each offering once it has a
          Primary Lecturer.
        </EmptyState>
      ) : (
        <Card list role="list">
          {offerings.map((o, i) => (
            <div
              key={o.id}
              role="listitem"
              aria-label={`${o.courseCode} ${o.title}`}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-body">
                  <span className="text-meta text-ink-muted">{String(i + 1)}.</span>{" "}
                  <Link
                    to="/admin/offerings/$offeringId"
                    params={{ offeringId: o.id }}
                    className="font-medium text-brand underline-offset-2 hover:underline"
                  >
                    <span className="font-mono text-code">{o.courseCode}</span> {o.title}
                  </Link>
                </p>
                <p className="text-meta text-ink-muted">
                  <CalendarDate value={o.startsOn} /> to <CalendarDate value={o.endsOn} /> · exam{" "}
                  <CalendarDate value={o.examOn} />
                  {o.lecturers.length === 0 ? " · no Lecturer yet" : ""}
                </p>
              </div>
              <OfferingStatusBadge status={o.status} />
            </div>
          ))}
        </Card>
      )}
      {unscheduled.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-label">Not scheduled yet</h3>
          <p className="flex flex-wrap gap-2">
            {unscheduled.map((u) => (
              <Badge key={u.courseId} tone="neutral">
                {u.courseCode}
              </Badge>
            ))}
          </p>
        </div>
      ) : null}
      <PlanSchedule schedule={schedule.data} open={planning} onOpenChange={setPlanning} />
    </section>
  );
}

/** The day after an ISO date, so a new plan can start where the schedule ends. */
function dayAfter(isoDate: string): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

function PlanSchedule(props: {
  schedule: CohortSchedule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { cohort, offerings, unscheduled } = props.schedule;
  const queryClient = useQueryClient();
  const formId = useId();
  const { busy, problem, fieldErrors, run } = useSubmit();
  const live = offerings.filter((o) => o.status !== "CANCELLED");
  const last = live.at(-1);
  const suggested = last === undefined ? cohort.startsOn : dayAfter(last.endsOn);
  return (
    <Sheet
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={`Plan ${cohort.code}'s courses`}
      footer={
        <Button type="submit" form={formId} variant="primary" block loading={busy}>
          Create draft offerings
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
            await api<typeof cohorts.planCohortSchedule>("POST", "/cohorts/:id/schedule", {
              params: { id: cohort.id },
              body: {
                startsOn: formText(d, "startsOn"),
                weeksPerCourse: Number(formText(d, "weeksPerCourse")),
              },
            });
            await queryClient.invalidateQueries({ queryKey: ["cohorts"] });
            await queryClient.invalidateQueries({ queryKey: ["offerings"] });
            props.onOpenChange(false);
          });
        }}
      >
        <p className="text-body-sm text-ink-muted">
          {unscheduled.map((u) => u.courseCode).join(", ")} will be laid end to end in curriculum
          order, each ending with its exam. You can move any offering's dates afterwards.
        </p>
        {problem ? (
          <Banner tone="danger" title={problem.title}>
            {problem.body}
          </Banner>
        ) : null}
        <TextField
          name="startsOn"
          type="date"
          label="First course starts on"
          defaultValue={suggested}
          min={cohort.startsOn}
          required
          error={fieldErrors.startsOn}
        />
        <TextField
          name="weeksPerCourse"
          type="number"
          min={1}
          max={26}
          label="Weeks per course"
          defaultValue="4"
          required
          error={fieldErrors.weeksPerCourse}
        />
      </form>
    </Sheet>
  );
}

/** Rooms where the in-person part of a Class Meeting takes place (TRD §9.1). */
export function AdminRoomsPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Rooms" meta="Rooms on campus where Class Meetings can take place." />
      <Rooms />
    </div>
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
      <div className="flex flex-wrap items-center justify-end gap-3">
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
