import type { ApplicationStatus, applications } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  applicationQuery,
  ENDED,
  mineQuery,
  STATUS_LABEL,
  WITHDRAWABLE,
} from "../api/applications";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { Time } from "../components/time";
import { Badge, type Tone } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/dialog";
import { EmptyState } from "../components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { useSubmit } from "../components/use-submit";

/** The colour that goes with each status word (UI-3); the word from STATUS_LABEL carries the meaning. */
const STATUS_TONE: Record<ApplicationStatus, Tone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  UNDER_REVIEW: "brand",
  ADMITTED: "success",
  ACCEPTED: "success",
  REJECTED: "neutral",
  LAPSED: "warning",
  WITHDRAWN: "neutral",
};

/** An application's status as a Badge; the applicant's and the officers' screens share it. */
export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

function Loading() {
  return (
    <SkeletonGroup label="Loading your application">
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-40" />
    </SkeletonGroup>
  );
}

/** The applicant's status page: reference number, status timeline, withdraw (TRD §10.2–10.3). */
export function ApplicationPage() {
  const mine = useQuery(mineQuery);
  if (mine.isPending) return <Loading />;
  if (mine.isError)
    return <LoadFailed what="your application" onRetry={() => void mine.refetch()} />;
  const latest = mine.data.items[0];
  if (latest === undefined)
    return (
      <div className="space-y-5">
        <PageHeader title="Your application" />
        <Card>
          <EmptyState
            icon="file"
            title="You haven't started an application yet"
            action={
              <Button asChild variant="primary">
                <Link to="/apply">See how to apply</Link>
              </Button>
            }
          />
        </Card>
      </div>
    );
  return <StatusView id={latest.id} />;
}

function StatusView({ id }: { id: string }) {
  const application = useQuery(applicationQuery(id));
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  if (application.isPending) return <Loading />;
  if (application.isError)
    return <LoadFailed what="your application" onRetry={() => void application.refetch()} />;
  const a = application.data;

  // ConfirmDialog shows a failure itself, so the request's error is left to throw.
  const withdraw = async () => {
    const withdrawn = await api<typeof applications.withdrawApplication>(
      "POST",
      "/applications/:id/withdraw",
      { params: { id } },
    );
    queryClient.setQueryData(applicationQuery(id).queryKey, withdrawn);
    await queryClient.invalidateQueries({ queryKey: ["applications", "mine"] });
    setConfirming(false);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Your application"
        meta={`${a.programme.name} · ${a.studyMode === "ON_CAMPUS" ? "On campus" : "Online"} · ${a.intake.academicSessionName}`}
      />

      <Card className="space-y-3">
        <p className="text-body">
          Status: <ApplicationStatusBadge status={a.status} />
        </p>
        {a.referenceNo === null ? null : (
          <p className="text-body">
            Application Reference No: <strong className="font-mono">{a.referenceNo}</strong>
          </p>
        )}
        {a.status === "DRAFT" ? (
          <Button asChild variant="primary">
            <Link to="/application/edit">Continue your application</Link>
          </Button>
        ) : null}
        {a.status === "ADMITTED" && a.offer !== null ? (
          <Offer
            applicationId={a.id}
            expiresAt={a.offer.expiresAt}
            programmeName={a.programme.name}
          />
        ) : null}
        {a.status === "ACCEPTED" && a.enrollment !== null ? (
          <Banner tone="success" title="Welcome to GLIM!">
            <p className="text-body">
              Your Matric Number is <strong>{a.enrollment.matricNumber}</strong>.
            </p>
            <p>
              We've emailed you the next steps. Keep signing in with this Google account; your
              courses appear here when registration opens for your first semester.
            </p>
          </Banner>
        ) : null}
        {a.status === "LAPSED" ? (
          <p className="text-body-sm text-ink-muted">
            Your offer lapsed because it wasn't accepted in time. If you'd still like to study with
            us, contact Admissions, who can reopen it.
          </p>
        ) : null}
        {a.status === "SUBMITTED" ? (
          <p className="text-body-sm text-ink-muted">
            We've emailed you a receipt. We review applications as they arrive and will email you
            when there's a decision.
          </p>
        ) : null}
        {ENDED.includes(a.status) ? (
          <Button asChild variant="secondary">
            <Link to="/application/edit">Start a new application</Link>
          </Button>
        ) : null}
      </Card>

      <section className="space-y-2">
        <h2 className="text-heading">History</h2>
        <ol className="space-y-2 border-l-2 border-line pl-4 text-body-sm">
          {a.timeline.map((event) => (
            <li key={`${event.status}-${event.at}`}>
              <strong>{STATUS_LABEL[event.status]}</strong>
              <span className="text-ink-muted">
                {" "}
                · <Time value={event.at} />
              </span>
            </li>
          ))}
        </ol>
      </section>

      {WITHDRAWABLE.includes(a.status) ? (
        <section>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Withdraw application
          </Button>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title="Withdraw your application?"
            confirmLabel="Withdraw application"
            tone="danger"
            onConfirm={withdraw}
          >
            You can't undo this, though you may apply again while the intake is open.
          </ConfirmDialog>
        </section>
      ) : null}
    </div>
  );
}

/** Days and hours left, e.g. "6 days, 3 hours"; under an hour, minutes. */
function remaining(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const plural = (n: number, unit: string) => `${String(n)} ${unit}${n === 1 ? "" : "s"}`;
  if (days > 0) return `${plural(days, "day")}, ${plural(hours, "hour")}`;
  if (hours > 0) return `${plural(hours, "hour")}, ${plural(minutes % 60, "minute")}`;
  return plural(minutes, "minute");
}

/** The offer with its countdown (spec stories 22, 24); accepting makes them a student at once. */
function Offer({
  applicationId,
  expiresAt,
  programmeName,
}: {
  applicationId: string;
  expiresAt: string;
  programmeName: string;
}) {
  const queryClient = useQueryClient();
  const { busy, problem, run } = useSubmit();
  const [now, setNow] = useState(() => Date.now());
  // One key per acceptance attempt, so a retried request can't enroll twice.
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const left = new Date(expiresAt).getTime() - now;

  return (
    <div className="space-y-3 rounded-md bg-success-soft p-4">
      <p className="text-body">
        Congratulations! You've been offered a place on the <strong>{programmeName}</strong>.
      </p>
      <p className="text-body-sm">
        Accept by <Time value={expiresAt} />{" "}
        {left > 0 ? <strong>({remaining(left)} left)</strong> : null}
      </p>
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      <Button
        variant="primary"
        block
        loading={busy}
        // Only the deadline closes the offer; a dropped connection never does (UI-7).
        disabled={left <= 0}
        onClick={() =>
          void run(async () => {
            const accepted = await api<typeof applications.acceptOffer>(
              "POST",
              "/applications/:id/accept",
              { params: { id: applicationId }, headers: { "idempotency-key": key.current } },
            );
            queryClient.setQueryData(applicationQuery(applicationId).queryKey, accepted);
            await queryClient.invalidateQueries({ queryKey: ["me"] });
          })
        }
      >
        Accept offer
      </Button>
    </div>
  );
}
