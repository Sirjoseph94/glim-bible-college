import type { Me, offerings } from "@glim/contracts";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../api/client";
import { meQuery } from "../api/session";
import { ClassMeetingCard } from "../components/app/class-meeting-card";
import { CourseCard } from "../components/app/course-card";
import { LoadFailed } from "../components/app/page-states";
import { planToday, type ScheduledMeeting } from "../components/app/today";
import { Time } from "../components/time";
import { myScheduleQuery, UpcomingMeetings } from "../components/meetings";
import { Badge } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";

function MeetingSection({ title, items }: { title: string; items: ScheduledMeeting[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-heading">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((m) => (
          <ClassMeetingCard key={m.id} meeting={m} />
        ))}
      </div>
    </section>
  );
}

function MyCourses({ schedule }: { schedule: ScheduledMeeting[] }) {
  const list = useQuery({
    queryKey: ["offerings", "mine"],
    queryFn: ({ signal }) =>
      api<typeof offerings.listOfferings>("GET", "/course-offerings", { signal }),
  });
  if (list.isPending)
    return (
      <SkeletonGroup label="Loading your courses">
        <Skeleton className="h-36" />
      </SkeletonGroup>
    );
  if (list.isError) return <LoadFailed what="your courses" onRetry={() => void list.refetch()} />;
  if (list.data.items.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-heading">My courses</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {list.data.items.map((o) => {
          const now = schedule.find(
            (m) => m.courseOfferingId === o.id && (m.state === "LIVE" || m.state === "OPEN"),
          );
          return (
            <CourseCard
              key={o.id}
              offering={o}
              badge={now ? <Badge status={now.state === "LIVE" ? "live" : "open"} /> : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}

/**
 * A student's Today (docs/ui-design-handoff.md §11.2): what to join now, the rest of today, then
 * their courses. Refreshed every 30 s while the tab is visible so a class shows when it opens.
 * "Continue watching" and "Due this week" wait on data the API doesn't return yet
 * (.scratch/ui-overhaul/issues/02).
 */
function StudentToday({ me }: { me: Me }) {
  const schedule = useQuery({ ...myScheduleQuery, refetchInterval: 30_000 });
  const items = schedule.data?.items ?? [];
  const plan = planToday(items, new Date(), me.user.timezone);
  const live = plan.happeningNow.some((m) => m.state === "LIVE");
  const started = plan.happeningNow.length > 0;
  const today = new Intl.DateTimeFormat("en-GB", {
    timeZone: me.user.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  return (
    <div className="space-y-5">
      {me.user.googleLinked ? null : (
        <Banner
          tone="warning"
          title="Link your Google account"
          action={
            <Button asChild size="sm" variant="secondary">
              <Link to="/profile">Link Google account</Link>
            </Button>
          }
        >
          You need it to join live classes.
        </Banner>
      )}
      <div>
        {/* Now first: the greeting shrinks when a class is waiting (§5). */}
        <h1 className={started ? "text-greeting" : "text-display"}>
          Welcome, {me.user.displayName}
        </h1>
        <p className="text-body-sm text-ink-muted">
          {today}
          {live ? " · your class has started" : started ? " · your class is open to join" : ""}
        </p>
        <p role="status" className="sr-only">
          {live ? "Your class is live now." : ""}
        </p>
      </div>
      {schedule.isPending ? (
        <SkeletonGroup label="Loading today's classes">
          <Skeleton className="h-32" />
        </SkeletonGroup>
      ) : schedule.isError ? (
        <LoadFailed what="your classes" onRetry={() => void schedule.refetch()} />
      ) : (
        <>
          <MeetingSection title="Happening now" items={plan.happeningNow} />
          <MeetingSection title="Later today" items={plan.laterToday} />
          {!started && plan.laterToday.length === 0 ? (
            <EmptyState icon="calendar" title="No classes today">
              {plan.next ? (
                <>
                  Your next class is <Time value={plan.next.scheduledStart} />.
                </>
              ) : (
                "No Class Meetings are scheduled for the next two weeks."
              )}
            </EmptyState>
          ) : null}
          {plan.next ? <MeetingSection title="Next class" items={[plan.next]} /> : null}
        </>
      )}
      <MyCourses schedule={items} />
    </div>
  );
}

export function HomePage() {
  const { data: me } = useSuspenseQuery(meQuery);
  if (me === null) return null;
  if (me.roles.isStudent) return <StudentToday me={me} />;
  // Lecturers and staff keep this home until their screens move (WP-UI-09, WP-UI-10).
  return (
    <section className="space-y-2">
      <h1 className="text-title">Welcome, {me.user.displayName}</h1>
      {me.roles.staff.length > 0 ? (
        <p className="text-ink-muted">
          Signed in as {me.roles.staff.map((r) => r.replaceAll("_", " ").toLowerCase()).join(", ")}.
        </p>
      ) : null}
      <UpcomingMeetings title="Your Class Meetings in the next two weeks" />
    </section>
  );
}
