import type { OpsFailure, ops } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { Time } from "../components/time";
import { Badge } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { bodyCell, DataTable, headCell, numericCell } from "../components/ui/data-table";
import { EmptyState } from "../components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { useSubmit } from "../components/use-submit";

const KIND_LABELS: Record<OpsFailure["kind"], string> = {
  "provider-event": "Provider event",
  video: "Video",
  "meeting-provision": "Google Meet link",
  recording: "Recording upload",
  subscription: "Meet events subscription",
  email: "Email address",
  job: "Job",
};

const REPLAY_LABELS: Record<OpsFailure["kind"], string> = {
  "provider-event": "Process again",
  video: "Recheck link",
  "meeting-provision": "Ask Google again",
  recording: "Upload again",
  subscription: "Renew",
  email: "Email again",
  job: "Run again",
};

/** Everything that failed, in one place, with a way to replay it (TRD §15.3). */
export function AdminOpsPage() {
  const list = useQuery({
    queryKey: ["ops", "failures"],
    queryFn: ({ signal }) =>
      api<typeof ops.listOpsFailures>("GET", "/admin/ops/failures", { signal }),
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Ops" meta="What failed, and how the integrations are doing." />
      <YouTubeCheck />
      <section className="space-y-3">
        <h2 className="text-heading">Failures</h2>
        {list.isPending ? (
          <SkeletonGroup label="Loading the failures">
            <Skeleton className="h-40" />
          </SkeletonGroup>
        ) : list.isError ? (
          <LoadFailed what="the failures" onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState icon="check" title="Nothing has failed" headingLevel={3} />
        ) : (
          <DataTable caption="Failures" minWidth="min-w-200">
            <thead>
              <tr>
                <th scope="col" className={headCell}>
                  What
                </th>
                <th scope="col" className={headCell}>
                  Status
                </th>
                <th scope="col" className={headCell}>
                  Detail
                </th>
                <th scope="col" className={headCell}>
                  When
                </th>
                <th scope="col" className={headCell}>
                  <span className="sr-only">Replay</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((f) => (
                <FailureRow key={`${f.kind}:${f.id}`} failure={f} />
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
    </div>
  );
}

function FailureRow({ failure: f }: { failure: OpsFailure }) {
  const queryClient = useQueryClient();
  const { busy, problem, run } = useSubmit();
  return (
    <tr aria-label={f.label} className="align-top">
      <td className={`${bodyCell} whitespace-normal`}>
        <span className="block text-meta text-ink-muted">{KIND_LABELS[f.kind]}</span>
        {f.label}
      </td>
      <td className={bodyCell}>
        <Badge tone="danger">{f.status}</Badge>
      </td>
      <td className={`${bodyCell} min-w-48 whitespace-normal text-ink-muted`}>{f.detail ?? "–"}</td>
      <td className={`${bodyCell} text-ink-muted`}>
        <Time value={f.occurredAt} />
      </td>
      <td className={`${bodyCell} whitespace-normal`}>
        {f.replayable ? (
          <div className="space-y-1">
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => {
                void run(async () => {
                  await api<typeof ops.replayOpsFailure>("POST", "/admin/ops/replay/:kind/:id", {
                    params: { kind: f.kind, id: f.id },
                  });
                  await queryClient.invalidateQueries({ queryKey: ["ops"] });
                });
              }}
            >
              {REPLAY_LABELS[f.kind]}
            </Button>
            {problem ? (
              <p role="alert" className="text-body-sm text-danger">
                {problem.title}
              </p>
            ) : null}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function YouTubeCheck() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["ops", "youtube"],
    queryFn: ({ signal }) =>
      api<typeof ops.getYouTubeStatus>("GET", "/admin/integrations/youtube/status", { signal }),
  });
  const { busy, problem, run } = useSubmit();
  const s = status.data?.status ?? null;
  return (
    <section aria-label="YouTube">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-heading">YouTube</h2>
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => {
              void run(async () => {
                await api<typeof ops.testYouTube>("POST", "/admin/integrations/youtube/test", {});
                // The check runs in the background; look again shortly.
                setTimeout(() => {
                  void queryClient.invalidateQueries({ queryKey: ["ops", "youtube"] });
                }, 3000);
              });
            }}
          >
            Check now
          </Button>
        </div>
        {problem ? (
          <Banner tone="danger" title={problem.title}>
            {problem.body}
          </Banner>
        ) : null}
        {status.isError ? (
          <LoadFailed what="the YouTube check" onRetry={() => void status.refetch()} />
        ) : s === null ? (
          <p className="text-body-sm text-ink-muted">Not checked yet.</p>
        ) : (
          <div className="space-y-2 text-body-sm">
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={s.ok ? "success" : "danger"}>
                {s.ok ? "Working" : "Needs attention"}
              </Badge>
              <span className="text-ink-muted">
                checked <Time value={s.checkedAt} />
              </span>
            </p>
            <p>
              Link checks (oEmbed): {s.reachable ? "reachable" : "unreachable"}
              {s.detail === null ? "" : ` · ${s.detail}`}
            </p>
            <ul className="space-y-1">
              {s.channels.map((c) => (
                <li key={c.url} className="break-all">
                  <span className={c.resolves ? "text-success" : "text-danger"}>
                    {c.resolves ? "✓" : "✗"}
                  </span>{" "}
                  {c.url}
                  {c.detail === null ? "" : ` · ${c.detail}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </section>
  );
}

/** The job queues (TRD §20.1): depth, active work, recent failures and the oldest wait. */
export function AdminJobsPage() {
  const list = useQuery({
    queryKey: ["ops", "queues"],
    refetchInterval: 15_000,
    queryFn: ({ signal }) => api<typeof ops.listQueues>("GET", "/admin/jobs", { signal }),
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Job queues"
        meta="A queue whose oldest waiting job is over 2 minutes old is falling behind; you're emailed about it."
      />
      {list.isPending ? (
        <SkeletonGroup label="Loading the job queues">
          <Skeleton className="h-48" />
        </SkeletonGroup>
      ) : list.isError ? (
        <LoadFailed what="the job queues" onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon="clock" title="No job queues yet" />
      ) : (
        <DataTable caption="Job queues" minWidth="min-w-160">
          <thead>
            <tr>
              <th scope="col" className={headCell}>
                Queue
              </th>
              <th scope="col" className={`${headCell} ${numericCell}`}>
                Waiting
              </th>
              <th scope="col" className={`${headCell} ${numericCell}`}>
                Running
              </th>
              <th scope="col" className={`${headCell} ${numericCell}`}>
                Failed (24 h)
              </th>
              <th scope="col" className={headCell}>
                Oldest wait
              </th>
            </tr>
          </thead>
          <tbody>
            {list.data.items.map((q) => (
              <tr key={q.name}>
                <td className={`${bodyCell} font-mono text-code`}>{q.name}</td>
                <td className={`${bodyCell} ${numericCell}`}>{q.queued}</td>
                <td className={`${bodyCell} ${numericCell}`}>{q.active}</td>
                <td className={`${bodyCell} ${numericCell}`}>{q.failedLastDay}</td>
                <td className={bodyCell}>
                  <span className="inline-flex items-center gap-2">
                    <span className="tabular-nums">
                      {q.oldestQueuedSeconds === null ? "–" : `${String(q.oldestQueuedSeconds)} s`}
                    </span>
                    {q.behind ? <Badge tone="danger">Behind</Badge> : null}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
