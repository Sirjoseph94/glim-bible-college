import type { enrollment, MyRegistration, offerings } from "@glim/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { CourseCard } from "../components/app/course-card";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { CalendarDate } from "../components/time";
import { Badge, type Tone } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Card } from "../components/ui/card";
import { EmptyState } from "../components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { credits } from "../design/format";

type Course = MyRegistration["programmes"][number]["courses"][number];

/** "3.0" (numeric(4,1)) as tenths of a credit, so totals stay exact (no floats). */
function creditTenths(text: string): number {
  const [whole = "0", fraction = ""] = text.split(".");
  return Number(whole) * 10 + Number((fraction + "0").slice(0, 1));
}

/** Where a course stands for the student: registration first, then the offering's dates. */
function courseState(c: Course): { tone: Tone; word: string } {
  if (c.status === "WITHDRAWN") return { tone: "neutral", word: "Withdrawn" };
  if (c.status === "COMPLETED" || c.offeringStatus === "COMPLETED")
    return { tone: "info", word: "Completed" };
  if (c.offeringStatus === "ACTIVE") return { tone: "success", word: "Now" };
  return { tone: "brand", word: "Upcoming" };
}

/**
 * A student's course schedule (§9.3, ADR-0005): their programme and its courses one after
 * another, each with its dates, its exam date and any makeup exam.
 */
export function RegistrationPage() {
  const mine = useQuery({
    queryKey: ["me", "registration"],
    queryFn: ({ signal }) =>
      api<typeof enrollment.getMyRegistration>("GET", "/me/registration", { signal }),
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Course schedule"
        meta="Your courses one after another, with their dates and exams."
      />
      {mine.isPending ? (
        <SkeletonGroup label="Loading your course schedule">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-40" />
        </SkeletonGroup>
      ) : mine.isError ? (
        <LoadFailed what="your course schedule" onRetry={() => void mine.refetch()} />
      ) : mine.data.programmes.length === 0 ? (
        <EmptyState icon="book" title="No programme yet">
          Your courses appear here once you're admitted to a programme.
        </EmptyState>
      ) : (
        mine.data.programmes.map((p) => {
          const counted = p.courses.filter((c) => c.status !== "WITHDRAWN");
          const total = counted.reduce((sum, c) => sum + creditTenths(c.credits), 0);
          return (
            <section key={p.matricNumber} className="space-y-3">
              <div className="space-y-1">
                <h2 className="text-heading">{p.programme.name}</h2>
                <p className="text-body-sm text-ink-muted">
                  Matric Number <span className="font-mono text-code">{p.matricNumber}</span> ·{" "}
                  {p.cohort.name} · {p.studyMode === "ON_CAMPUS" ? "On campus" : "Online"}
                </p>
              </div>
              {p.courses.length === 0 ? (
                <EmptyState icon="calendar" title="Nothing scheduled yet" headingLevel={3}>
                  Your cohort's courses appear here as soon as each one is published.
                </EmptyState>
              ) : (
                <Card className="space-y-4">
                  <p className="text-label text-ink">
                    {counted.length} {counted.length === 1 ? "course" : "courses"} ·{" "}
                    {credits(total)} credits
                  </p>
                  <ol className="divide-y divide-line" aria-label="Your courses">
                    {p.courses.map((c) => {
                      const state = courseState(c);
                      return (
                        <li
                          key={c.courseEnrollmentId}
                          className="flex flex-wrap items-center gap-2 py-3 first:pt-0"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-body text-ink">
                              <span className="font-mono text-code text-brand">{c.courseCode}</span>{" "}
                              {c.title}
                            </p>
                            <p className="text-meta text-ink-muted">
                              <CalendarDate value={c.startsOn} /> to{" "}
                              <CalendarDate value={c.endsOn} /> · exam{" "}
                              <CalendarDate value={c.examOn} />
                              {c.makeupOn === null ? null : (
                                <>
                                  {" "}
                                  · Incomplete — makeup exam on <CalendarDate value={c.makeupOn} />
                                </>
                              )}{" "}
                              · {c.credits} credits
                            </p>
                          </div>
                          <Badge tone={state.tone}>{state.word}</Badge>
                        </li>
                      );
                    })}
                  </ol>
                </Card>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

/** A student's courses: the offerings they're registered for (via v_offering_access). */
/** The student's courses as cards, each opening the course page (§11.3, decision UI-Q5). */
export function CoursesPage() {
  const list = useQuery({
    queryKey: ["offerings", "mine"],
    queryFn: ({ signal }) =>
      api<typeof offerings.listOfferings>("GET", "/course-offerings", { signal }),
  });
  return (
    <div className="space-y-4">
      <h1 className="text-title">My courses</h1>
      {list.isPending ? (
        <SkeletonGroup label="Loading your courses">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        </SkeletonGroup>
      ) : list.isError ? (
        <Banner tone="danger">We couldn't load your courses.</Banner>
      ) : list.data.items.length === 0 ? (
        <EmptyState icon="book" title="No courses yet">
          Your courses appear here once your cohort's first course is published.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {list.data.items.map((o) => (
            <CourseCard key={o.id} offering={o} />
          ))}
        </div>
      )}
    </div>
  );
}
