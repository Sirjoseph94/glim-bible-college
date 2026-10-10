import type { attendance, meetings, offerings, video } from "@glim/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { api } from "../api/client";
import { useDetailBar } from "../components/app/app-shell";
import { ClassMeetingCard } from "../components/app/class-meeting-card";
import { PageHeader } from "../components/app/page-header";
import { CourseAssignments } from "../components/assignments";
import { CourseAnnouncements, CourseMaterials } from "../components/course-content";
import { MyGrades } from "../components/grades";
import { CourseQuizzes } from "../components/quizzes";
import { Time } from "../components/time";
import { Badge, type BadgeStatus } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Card } from "../components/ui/card";
import { EmptyState } from "../components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { Tabs } from "../components/ui/tabs";
import { Icon } from "../design/icons";
import type { CourseTab } from "./course-tabs";

const ATTENDANCE_BADGE: Record<string, BadgeStatus> = {
  PRESENT: "present",
  PARTIAL: "partial",
  ABSENT: "absent",
  EXCUSED: "excused",
};

function Overview({ offeringId }: { offeringId: string }) {
  const mine = useQuery({
    queryKey: ["me", "attendance"],
    queryFn: ({ signal }) =>
      api<typeof attendance.getMyAttendance>("GET", "/me/attendance", { signal }),
  });
  const course = mine.data?.courses.find((c) => c.offeringId === offeringId);
  return (
    <div className="space-y-5">
      {course ? (
        <section className="space-y-2">
          <h2 className="text-heading">Your attendance</h2>
          <div className="flex flex-wrap gap-2">
            <Badge tone="success">{course.summary.present} Present</Badge>
            <Badge tone="warning">{course.summary.partial} Partial</Badge>
            <Badge tone="danger">{course.summary.absent} Absent</Badge>
            {course.summary.excused > 0 ? (
              <Badge tone="info">{course.summary.excused} Excused</Badge>
            ) : null}
          </div>
        </section>
      ) : null}
      <section className="space-y-2">
        <h2 className="text-heading">Announcements</h2>
        <CourseAnnouncements offeringId={offeringId} manage={false} />
      </section>
    </div>
  );
}

function Live({ offeringId }: { offeringId: string }) {
  const list = useQuery({
    queryKey: ["class-meetings", offeringId],
    // Refreshed every 30 s while the page is visible, so a class shows when it opens (§9.14).
    refetchInterval: 30_000,
    queryFn: ({ signal }) =>
      api<typeof meetings.listClassMeetings>("GET", "/course-offerings/:id/class-meetings", {
        params: { id: offeringId },
        signal,
      }),
  });
  const mine = useQuery({
    queryKey: ["me", "attendance"],
    queryFn: ({ signal }) =>
      api<typeof attendance.getMyAttendance>("GET", "/me/attendance", { signal }),
  });
  if (list.isPending)
    return (
      <SkeletonGroup label="Loading Class Meetings">
        <Skeleton className="h-32" />
      </SkeletonGroup>
    );
  if (list.isError) return <Banner tone="danger">We couldn't load the Class Meetings.</Banner>;
  const now = Date.now();
  const upcoming = list.data.items.filter(
    (m) => m.state !== "ENDED" && m.state !== "NO_SHOW" && new Date(m.scheduledEnd).getTime() > now,
  );
  const past = mine.data?.courses.find((c) => c.offeringId === offeringId)?.meetings ?? [];
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h2 className="text-heading">Coming up</h2>
        {upcoming.length === 0 ? (
          <p className="text-body-sm text-ink-muted">No Class Meetings are scheduled yet.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {upcoming.map((m) => (
              <ClassMeetingCard key={m.id} meeting={m} />
            ))}
          </div>
        )}
      </section>
      {past.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-heading">Your attendance</h2>
          <Card list>
            {past.map((m) => (
              <div key={m.meetingId} className="flex items-center gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-subhead">{m.title}</p>
                  <p className="text-meta text-ink-muted">
                    <Time value={m.scheduledStart} />
                    {m.mode === "IN_PERSON"
                      ? " · in the room"
                      : m.mode === "ONLINE"
                        ? " · online"
                        : ""}
                    {m.late ? " · late" : ""}
                    {m.final ? "" : " · provisional"}
                  </p>
                </div>
                {ATTENDANCE_BADGE[m.status] ? (
                  <Badge status={ATTENDANCE_BADGE[m.status] as BadgeStatus} />
                ) : null}
              </div>
            ))}
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function minutes(ms: number | null): string | null {
  return ms === null ? null : `${String(Math.max(1, Math.round(ms / 60_000)))} min`;
}

function Recordings({ offeringId }: { offeringId: string }) {
  const list = useRecordings(offeringId);
  if (list.isPending)
    return (
      <SkeletonGroup label="Loading recordings">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </SkeletonGroup>
    );
  if (list.isError) return <Banner tone="danger">We couldn't load the recordings.</Banner>;
  if (list.data.items.length === 0)
    return (
      <EmptyState icon="video" title="No recordings yet">
        Recordings appear here after a class, once your Lecturer adds them.
      </EmptyState>
    );
  return (
    <Card list>
      {list.data.items.map((v) => (
        <Link
          key={v.id}
          to="/recordings/$videoId"
          params={{ videoId: v.id }}
          className="flex items-center gap-3 px-4 py-3.5 transition-colors duration-120 hover:bg-surface-sunken"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
            <Icon name="play" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-subhead text-ink">{v.title}</span>
            {minutes(v.durationMs) ? (
              <span className="block text-meta text-ink-muted">{minutes(v.durationMs)}</span>
            ) : null}
          </span>
          <Badge status="available" />
        </Link>
      ))}
    </Card>
  );
}

function useRecordings(offeringId: string) {
  return useQuery({
    queryKey: ["videos", offeringId],
    queryFn: ({ signal }) =>
      api<typeof video.listVideos>("GET", "/course-offerings/:id/videos", {
        params: { id: offeringId },
        signal,
      }),
  });
}

/**
 * A course, for a student (docs/ui-design-handoff.md §11.3; decision UI-Q5): its sections as
 * tabs, the selected one in the URL (`?tab=recordings`) so back and refresh keep it.
 */
export function CoursePage() {
  const { offeringId } = useParams({ from: "/courses/$offeringId" });
  const tab = useSearch({ from: "/courses/$offeringId" }).tab ?? "overview";
  const navigate = useNavigate({ from: "/courses/$offeringId" });
  const offering = useQuery({
    queryKey: ["offering", offeringId],
    queryFn: ({ signal }) =>
      api<typeof offerings.getOffering>("GET", "/course-offerings/:id", {
        params: { id: offeringId },
        signal,
      }),
  });
  const recordings = useRecordings(offeringId);
  useDetailBar({
    back: { to: "/courses", label: "My courses" },
    ...(offering.data ? { code: offering.data.courseCode } : {}),
  });

  if (offering.isPending)
    return (
      <SkeletonGroup label="Loading the course">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40" />
      </SkeletonGroup>
    );
  if (offering.isError)
    return (
      <EmptyState
        icon="info"
        title="This page isn't available to you"
        action={
          <Link to="/" className="text-brand underline">
            Go to Home
          </Link>
        }
      />
    );
  const o = offering.data;
  const lecturers = o.lecturers
    .filter((l) => l.status === "ACTIVE")
    .map((l) => l.lecturerName)
    .join(", ");
  const recordingCount = recordings.data?.items.length;
  return (
    <div className="space-y-4">
      <PageHeader
        overline={o.courseCode}
        title={o.title}
        meta={[lecturers, `${o.credits} credits`].filter(Boolean).join(" · ")}
      />
      <Tabs
        label="Course sections"
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "live", label: "Live" },
          {
            value: "recordings",
            label: "Recordings",
            ...(recordingCount ? { count: recordingCount } : {}),
          },
          { value: "work", label: "Work" },
          { value: "grades", label: "Grades" },
          { value: "materials", label: "Materials" },
        ]}
        value={tab}
        onValueChange={(value) => {
          void navigate({ search: { tab: value as CourseTab }, replace: true });
        }}
      >
        {(value) =>
          value === "live" ? (
            <Live offeringId={offeringId} />
          ) : value === "recordings" ? (
            <Recordings offeringId={offeringId} />
          ) : value === "work" ? (
            <div className="space-y-5">
              <section className="space-y-2">
                <h2 className="text-heading">Assignments</h2>
                <CourseAssignments offeringId={offeringId} manage={false} />
              </section>
              <section className="space-y-2">
                <h2 className="text-heading">Quizzes and exams</h2>
                <CourseQuizzes offeringId={offeringId} manage={false} />
              </section>
            </div>
          ) : value === "grades" ? (
            <MyGrades offeringId={offeringId} />
          ) : value === "materials" ? (
            <CourseMaterials offeringId={offeringId} manage={false} />
          ) : (
            <Overview offeringId={offeringId} />
          )
        }
      </Tabs>
    </div>
  );
}
