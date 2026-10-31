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
import { myScheduleQuery } from "../components/meetings";
import { navItems } from "../components/app/nav";
import { homeView, useStoredView } from "../components/app/view";
import { STAFF_ROLE_LABELS } from "../api/users";
import { cardClass } from "../components/ui/card";
import { Icon } from "../design/icons";
import { Badge } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button, buttonClass } from "../components/ui/button";
import { LecturerMeetingActions } from "../components/teaching/class-meetings";
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
 * (.scratch/ui-overhaul/issues/07).
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

/**
 * A Lecturer's Today (docs/ui-design-handoff.md §11.7, decision UI-Q6): the class to start now,
 * the rest of today, then what's coming up, each with its actions. "Needs your attention" waits
 * on data the API doesn't return yet (.scratch/ui-overhaul/issues/08); the Meet lobby count
 * won't be built (.out-of-scope/meet-lobby-count.md).
 */
function LecturerToday({ me }: { me: Me }) {
  const schedule = useQuery({ ...myScheduleQuery, refetchInterval: 30_000 });
  const plan = planToday(schedule.data?.items ?? [], new Date(), me.user.timezone, "LECTURER");
  const started = plan.happeningNow.length > 0;
  const section = (title: string, items: ScheduledMeeting[]) =>
    items.length === 0 ? null : (
      <section className="space-y-3">
        <h2 className="text-heading">{title}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((m) => (
            <ClassMeetingCard
              key={m.id}
              meeting={m}
              actions={<LecturerMeetingActions meeting={m} />}
            />
          ))}
        </div>
      </section>
    );
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
          Link your Google account so you can co-host your classes.
        </Banner>
      )}
      <h1 className="text-greeting">Welcome, {me.user.displayName}</h1>
      {schedule.isPending ? (
        <SkeletonGroup label="Loading your classes">
          <Skeleton className="h-32" />
        </SkeletonGroup>
      ) : schedule.isError ? (
        <LoadFailed what="your classes" onRetry={() => void schedule.refetch()} />
      ) : (
        <>
          {section("Happening now", plan.happeningNow)}
          {plan.happeningNow.some((m) => m.state === "OPEN" && m.recordingMode !== "OFF") ? (
            <Banner tone="info" title="Recording starts when you join">
              Open the class on the room computer, signed in as you, so online students can see and
              hear the room.
            </Banner>
          ) : null}
          {section("Later today", plan.laterToday)}
          {!started && plan.laterToday.length === 0 ? (
            <EmptyState icon="calendar" title="No classes today">
              {plan.next
                ? "Your next classes are under Coming up."
                : "No Class Meetings in the next two weeks."}
            </EmptyState>
          ) : null}
          {section("Coming up", plan.comingUp)}
          <Link to="/teach" className={buttonClass({ variant: "secondary" })}>
            All your courses
          </Link>
        </>
      )}
    </div>
  );
}

/** What each area holds, for the cards on a staff Home. */
const AREA_HINTS: Record<string, string> = {
  "/application": "Your application to study at GLIM.",
  "/results": "Your results and transcripts.",
  "/admissions": "Applications, intakes and reports.",
  "/admin/academic": "Programmes, cohorts, Course Offerings, Rooms, Lecturers and imports.",
  "/results/cohorts": "Course results, approval and awards.",
  "/admin/users": "Accounts and roles.",
  "/admin/settings": "College details, videos and the audit log.",
  "/admin/ops": "Failures, job queues and the Google and YouTube integrations.",
};

/**
 * Home for staff, applicants and graduates (composed, §11.11): who they are signed in as, and
 * a card for each area they can open. Their work lives in those areas.
 */
function AreasHome({ me }: { me: Me }) {
  const areas = navItems(me.roles).filter((item) => item.to !== "/" && item.to !== "/profile");
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-greeting">Welcome, {me.user.displayName}</h1>
        {me.roles.staff.length > 0 ? (
          <p className="text-body-sm text-ink-muted">
            Signed in as {me.roles.staff.map((r) => STAFF_ROLE_LABELS[r].toLowerCase()).join(", ")}.
          </p>
        ) : null}
      </div>
      {areas.length > 0 ? (
        <nav aria-label="Your areas" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {areas.map((area) => (
            <Link
              key={area.to}
              to={area.to}
              className={`${cardClass({ interactive: true })} flex items-start gap-3`}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
                <Icon name={area.icon} />
              </span>
              <span className="min-w-0">
                <span className="block text-heading text-ink">{area.label}</span>
                {AREA_HINTS[area.to] ? (
                  <span className="block text-body-sm text-ink-muted">{AREA_HINTS[area.to]}</span>
                ) : null}
              </span>
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

export function HomePage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const stored = useStoredView();
  if (me === null) return null;
  const view = homeView(me.roles, stored);
  if (view === "student") return <StudentToday me={me} />;
  if (view === "lecturer") return <LecturerToday me={me} />;
  return <AreasHome me={me} />;
}
