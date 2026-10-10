import type { Me } from "@glim/contracts";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { meQuery } from "../api/session";
import { ClassMeetingCard } from "../components/app/class-meeting-card";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { byDay } from "../components/app/today";
import { myScheduleQuery } from "../components/meetings";
import { LecturerMeetingActions } from "../components/teaching/class-meetings";
import { EmptyState } from "../components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";

/** "Today", "Tomorrow" or "Wed 14 Oct" (§10.6), for a YYYY-MM-DD day in the viewer's zone. */
function dayLabel(day: string, zone: string): string {
  const inZone = (offsetDays: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(
      Date.now() + offsetDays * 86_400_000,
    );
  if (day === inZone(0)) return "Today";
  if (day === inZone(1)) return "Tomorrow";
  // Noon UTC on that date names the same calendar day in every zone.
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${day}T12:00:00Z`));
}

/**
 * The person's Class Meetings for the next two weeks (docs/ui-design-handoff.md §11.11, composed:
 * "week list grouped by day"), the ones they attend with Join and the ones they teach with
 * their actions. Refreshed every 30 s while visible, so a class shows when it opens (§9.14).
 */
export function SchedulePage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const schedule = useQuery({ ...myScheduleQuery, refetchInterval: 30_000 });
  if (me === null) return null;
  return (
    <div className="space-y-5">
      <PageHeader title="Schedule" meta="Your Class Meetings in the next two weeks." />
      {schedule.isPending ? (
        <SkeletonGroup label="Loading your schedule">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </SkeletonGroup>
      ) : schedule.isError ? (
        <LoadFailed what="your schedule" onRetry={() => void schedule.refetch()} />
      ) : schedule.data.items.length === 0 ? (
        <EmptyState icon="calendar" title="Nothing scheduled">
          No Class Meetings in the next two weeks.
        </EmptyState>
      ) : (
        <Days me={me} items={schedule.data.items} />
      )}
    </div>
  );
}

function Days({ me, items }: { me: Me; items: Parameters<typeof byDay>[0] }) {
  const zone = me.user.timezone;
  return (
    <>
      {byDay(items, zone).map(({ day, meetings }) => (
        <section
          key={day}
          aria-label={dayLabel(day, zone)}
          className="space-y-3 lg:flex lg:gap-5 lg:space-y-0"
        >
          <h2 className="text-heading lg:w-40 lg:shrink-0 lg:pt-4">{dayLabel(day, zone)}</h2>
          <div className="grid flex-1 gap-4 md:grid-cols-2">
            {meetings.map((m) => (
              <ClassMeetingCard
                key={`${m.as}-${m.id}`}
                meeting={m}
                {...(m.as === "LECTURER"
                  ? { actions: <LecturerMeetingActions meeting={m} /> }
                  : {})}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
