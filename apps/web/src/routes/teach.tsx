import type { ClassMeeting, meetings, Offering, offerings, Video, video } from "@glim/contracts";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { lazy, Suspense, useState, type SubmitEvent } from "react";
import { api, ApiError } from "../api/client";
import { describeError, type ErrorCopy } from "../api/error-copy";
import { ClassMeetingCard } from "../components/app/class-meeting-card";
import { CourseCard } from "../components/app/course-card";
import { PageHeader } from "../components/app/page-header";
import { isNotAvailable, LoadFailed, NotAvailable } from "../components/app/page-states";
import { useDetailBar } from "../components/app/shell-parts";
import { CourseAssignments } from "../components/assignments";
import { CourseAnnouncements, CourseMaterials } from "../components/course-content";
import { formText } from "../components/form";
import { CourseQuizzes } from "../components/quizzes";
import {
  LecturerMeetingActions,
  ScheduleMeetingSheet,
} from "../components/teaching/class-meetings";
import { Time } from "../components/time";
import { Badge, type BadgeStatus, type Tone } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button, buttonClass } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { EmptyState } from "../components/ui/empty-state";
import { TextField } from "../components/ui/field";
import { IconButton } from "../components/ui/icon-button";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { Tabs } from "../components/ui/tabs";
import type { TeachTab } from "./teach-tabs";

/** The gradebook loads only when its tab is opened: it is the largest part of the page. */
const Gradebook = lazy(() => import("./gradebook").then((m) => ({ default: m.Gradebook })));

const myOfferingsQuery = queryOptions({
  queryKey: ["offerings", "mine"],
  queryFn: ({ signal }) =>
    api<typeof offerings.listOfferings>("GET", "/course-offerings", { signal }),
});

/**
 * The courses a Lecturer teaches (decision UI-Q5): each card opens the course's teaching page.
 * Their Class Meetings are on Today (§11.7) and in each course's Live tab.
 */
export function TeachPage() {
  const list = useQuery(myOfferingsQuery);
  return (
    <div className="space-y-5">
      <PageHeader title="Teaching" meta="The Course Offerings you teach." />
      {list.isPending ? (
        <SkeletonGroup label="Loading your courses">
          <Skeleton className="h-36" />
        </SkeletonGroup>
      ) : list.isError ? (
        <LoadFailed what="your courses" onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon="book" title="No courses yet">
          You aren't assigned to any Course Offerings yet. The academic office assigns them.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {list.data.items.map((o) => (
            <CourseCard
              key={o.id}
              offering={o}
              teaching
              badge={
                o.status === "COMPLETED" || o.status === "CANCELLED" ? (
                  <Badge tone="neutral">
                    {o.status === "COMPLETED" ? "Completed" : "Cancelled"}
                  </Badge>
                ) : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

const PAST_BADGE: Partial<Record<ClassMeeting["state"], BadgeStatus>> = {
  ENDED: "ended",
  NO_SHOW: "no_show",
  CANCELLED: "cancelled",
  SCHEDULED: "scheduled",
};

/** The course's Class Meetings: coming up as cards with their actions, past ones as rows. */
function Live({ offering }: { offering: Offering }) {
  const [scheduling, setScheduling] = useState(false);
  const list = useQuery({
    queryKey: ["class-meetings", offering.id],
    refetchInterval: 30_000,
    queryFn: ({ signal }) =>
      api<typeof meetings.listClassMeetings>("GET", "/course-offerings/:id/class-meetings", {
        params: { id: offering.id },
        signal,
      }),
  });
  const closed = offering.status === "COMPLETED" || offering.status === "CANCELLED";
  const now = Date.now();
  const items = list.data?.items ?? [];
  // Still to come, or running over its time; a cancelled one stays in place, struck through.
  const upcoming = items.filter(
    (m) =>
      m.state === "OPEN" ||
      m.state === "LIVE" ||
      ((m.state === "SCHEDULED" || m.state === "CANCELLED") &&
        new Date(m.scheduledEnd).getTime() > now),
  );
  const past = items
    .filter((m) => !upcoming.includes(m))
    .sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart));
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 md:flex-row">
        {closed ? null : (
          <Button
            variant="primary"
            icon="calendar"
            onClick={() => {
              setScheduling(true);
            }}
          >
            Schedule a Class Meeting
          </Button>
        )}
        <a
          href={`/api/v1/reports/attendance?offeringId=${offering.id}&format=csv`}
          className={buttonClass({ variant: "secondary" })}
        >
          Attendance (CSV)
        </a>
      </div>
      <ScheduleMeetingSheet offering={offering} open={scheduling} onOpenChange={setScheduling} />
      {list.isPending ? (
        <SkeletonGroup label="Loading Class Meetings">
          <Skeleton className="h-32" />
        </SkeletonGroup>
      ) : list.isError ? (
        <LoadFailed what="the Class Meetings" onRetry={() => void list.refetch()} />
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-heading">Coming up</h2>
            {upcoming.length === 0 ? (
              <p className="text-body-sm text-ink-muted">No Class Meetings are scheduled.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {upcoming.map((m) => (
                  <ClassMeetingCard
                    key={m.id}
                    meeting={m}
                    actions={<LecturerMeetingActions meeting={m} />}
                  />
                ))}
              </div>
            )}
          </section>
          {past.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-heading">Earlier</h2>
              <Card list role="list">
                {past.map((m) => (
                  <div
                    key={m.id}
                    role="listitem"
                    aria-label={m.title}
                    className="flex flex-wrap items-center gap-3 px-4 py-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className={
                          m.state === "CANCELLED"
                            ? "text-subhead text-ink-muted line-through"
                            : "text-subhead"
                        }
                      >
                        {m.title}
                      </p>
                      <p className="text-meta text-ink-muted">
                        <Time value={m.scheduledStart} />
                      </p>
                    </div>
                    {PAST_BADGE[m.state] ? (
                      <Badge status={PAST_BADGE[m.state] as BadgeStatus} />
                    ) : null}
                    {m.state === "CANCELLED" ? null : (
                      <div className="flex gap-2">
                        <Link
                          to="/teach/meetings/$meetingId/roll-call"
                          params={{ meetingId: m.id }}
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          Roll call
                        </Link>
                        <Link
                          to="/teach/meetings/$meetingId/attendance"
                          params={{ meetingId: m.id }}
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          Attendance
                        </Link>
                      </div>
                    )}
                  </div>
                ))}
              </Card>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

const VIDEO_STATUS: Record<Video["status"], { tone: Tone; word: string }> = {
  PROCESSING: { tone: "warning", word: "Processing" },
  UNPUBLISHED: { tone: "neutral", word: "Hidden" },
  PUBLISHED: { tone: "success", word: "Published" },
  UNAVAILABLE: { tone: "danger", word: "Unavailable" },
  FAILED: { tone: "danger", word: "Failed" },
  DELETED: { tone: "neutral", word: "Deleted" },
};

/**
 * The course's recordings (TRD §13.3, §13.6): add by YouTube link, publish or hide, and move
 * up or down. Only Primary and Co-lecturers (and admins) can change them; the server says so.
 */
function Recordings({ offeringId }: { offeringId: string }) {
  const queryClient = useQueryClient();
  const key = ["videos", offeringId];
  const list = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api<typeof video.listVideos>("GET", "/course-offerings/:id/videos", {
        params: { id: offeringId },
        signal,
      }),
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<(ErrorCopy & { fields: Record<string, string> }) | null>(
    null,
  );
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: key });
      return true;
    } catch (error) {
      setProblem({
        ...describeError(error),
        fields: error instanceof ApiError ? error.fieldErrors : {},
      });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const items = list.data?.items ?? [];
  const move = (index: number, by: number) => {
    const ids = items.map((v) => v.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(index + by, 0, moved);
    void run(() =>
      api<typeof video.reorderVideos>("PUT", "/course-offerings/:id/videos/order", {
        params: { id: offeringId },
        body: { videoIds: ids },
      }),
    );
  };
  const add = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const title = formText(form, "title");
    void run(() =>
      api<typeof video.addVideo>("POST", "/course-offerings/:id/videos", {
        params: { id: offeringId },
        headers: { "idempotency-key": crypto.randomUUID() },
        body: { youtubeUrl: formText(form, "youtubeUrl"), ...(title ? { title } : {}) },
      }),
    ).then((added) => {
      if (added) element.reset();
    });
  };
  if (list.isPending)
    return (
      <SkeletonGroup label="Loading recordings">
        <Skeleton className="h-16" />
      </SkeletonGroup>
    );
  if (list.isError) return <LoadFailed what="the recordings" onRetry={() => void list.refetch()} />;
  return (
    <div className="space-y-5">
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      {items.length === 0 ? (
        <EmptyState icon="video" title="No recordings yet">
          Add a YouTube link below; students see it once it is published.
        </EmptyState>
      ) : (
        <Card list role="list">
          {items.map((v, index) => {
            const status = VIDEO_STATUS[v.status];
            return (
              <div
                key={v.id}
                role="listitem"
                aria-label={v.title}
                className="flex flex-wrap items-center gap-2 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to="/recordings/$videoId"
                    params={{ videoId: v.id }}
                    className="text-subhead text-ink underline-offset-2 hover:underline"
                  >
                    {v.title}
                  </Link>
                  <div className="mt-1">
                    <Badge tone={status.tone}>{status.word}</Badge>
                  </div>
                </div>
                <IconButton
                  icon="chevronLeft"
                  label={`Move ${v.title} up`}
                  className="rotate-90"
                  disabled={busy || index === 0}
                  onClick={() => {
                    move(index, -1);
                  }}
                />
                <IconButton
                  icon="chevronRight"
                  label={`Move ${v.title} down`}
                  className="rotate-90"
                  disabled={busy || index === items.length - 1}
                  onClick={() => {
                    move(index, 1);
                  }}
                />
                {v.status === "PUBLISHED" || v.status === "UNPUBLISHED" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        v.status === "PUBLISHED"
                          ? api<typeof video.unpublishVideo>("POST", "/videos/:id/unpublish", {
                              params: { id: v.id },
                            })
                          : api<typeof video.publishVideo>("POST", "/videos/:id/publish", {
                              params: { id: v.id },
                              headers: { "idempotency-key": crypto.randomUUID() },
                            }),
                      )
                    }
                  >
                    {v.status === "PUBLISHED" ? "Hide" : "Publish"}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </Card>
      )}
      <Card>
        <form aria-label="Add a recording" className="space-y-4" onSubmit={add}>
          <h2 className="text-heading">Add a recording</h2>
          <TextField
            name="youtubeUrl"
            type="url"
            label="YouTube link"
            hint="Uploaded as Unlisted to GLIM's channel."
            required
            error={problem?.fields.youtubeUrl}
          />
          <TextField name="title" label="Title" optional hint="Taken from YouTube if left empty." />
          <Button type="submit" variant="primary" loading={busy}>
            Add recording
          </Button>
        </form>
      </Card>
    </div>
  );
}

/**
 * A course, for its Lecturers (docs/ui-design-handoff.md §11.9; decision UI-Q5): announcements,
 * Class Meetings, recordings, work, the gradebook and materials as tabs, the tab in the URL.
 */
export function TeachCoursePage() {
  const { offeringId } = useParams({ from: "/teach/$offeringId" });
  const tab = useSearch({ from: "/teach/$offeringId" }).tab ?? "overview";
  const navigate = useNavigate({ from: "/teach/$offeringId" });
  const offering = useQuery({
    queryKey: ["offering", offeringId],
    queryFn: ({ signal }) =>
      api<typeof offerings.getOffering>("GET", "/course-offerings/:id", {
        params: { id: offeringId },
        signal,
      }),
  });
  useDetailBar({
    back: { to: "/teach", label: "Teaching" },
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
    return isNotAvailable(offering.error) ? (
      <NotAvailable />
    ) : (
      <LoadFailed what="this course" onRetry={() => void offering.refetch()} />
    );
  const o = offering.data;
  const lecturers = o.lecturers
    .filter((l) => l.status === "ACTIVE")
    .map((l) => l.lecturerName)
    .join(", ");
  return (
    <div className="space-y-4">
      <PageHeader
        overline={`${o.courseCode} · ${o.sectionCode}`}
        title={o.title}
        meta={[`${o.semesterName}, ${o.sessionCode}`, lecturers].filter(Boolean).join(" · ")}
      />
      <Tabs
        label="Course sections"
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "live", label: "Live" },
          { value: "recordings", label: "Recordings" },
          { value: "work", label: "Work" },
          { value: "gradebook", label: "Gradebook" },
          { value: "materials", label: "Materials" },
        ]}
        value={tab}
        onValueChange={(value) => {
          void navigate({ search: { tab: value as TeachTab }, replace: true });
        }}
      >
        {(value) =>
          value === "live" ? (
            <Live offering={o} />
          ) : value === "recordings" ? (
            <Recordings offeringId={offeringId} />
          ) : value === "work" ? (
            <div className="space-y-5">
              <section className="space-y-2">
                <h2 className="text-heading">Assignments</h2>
                <CourseAssignments offeringId={offeringId} manage />
              </section>
              <section className="space-y-2">
                <h2 className="text-heading">Quizzes and exams</h2>
                <CourseQuizzes offeringId={offeringId} manage />
              </section>
            </div>
          ) : value === "gradebook" ? (
            <Suspense
              fallback={
                <SkeletonGroup label="Loading the gradebook">
                  <Skeleton className="h-60" />
                </SkeletonGroup>
              }
            >
              <Gradebook offeringId={offeringId} />
            </Suspense>
          ) : value === "materials" ? (
            <CourseMaterials offeringId={offeringId} manage />
          ) : (
            <section className="space-y-2">
              <h2 className="text-heading">Announcements</h2>
              <CourseAnnouncements offeringId={offeringId} manage />
            </section>
          )
        }
      </Tabs>
    </div>
  );
}
