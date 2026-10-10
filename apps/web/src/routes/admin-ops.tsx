import type { OpsFailure, ops } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Alert } from "../components/form";
import { Time } from "../components/time";
import { useSubmit } from "../components/use-submit";

const KIND_LABELS: Record<OpsFailure["kind"], string> = {
  "provider-event": "Provider event",
  video: "Video",
  "meeting-provision": "Class Meeting set-up",
  email: "Email address",
  job: "Job",
};

const REPLAY_LABELS: Record<OpsFailure["kind"], string> = {
  "provider-event": "Process again",
  video: "Recheck link",
  "meeting-provision": "",
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
    <div className="space-y-4">
      <h1 className="text-title">Ops</h1>
      <YouTubeCheck />
      <section className="space-y-2">
        <h3 className="font-medium">Failures</h3>
        {list.isPending ? <div className="h-24 animate-pulse rounded bg-slate-200" /> : null}
        {list.isError ? <Alert tone="error">We couldn't load the failures.</Alert> : null}
        {list.isSuccess && list.data.items.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing has failed.</p>
        ) : null}
        <ul className="space-y-2 text-sm">
          {(list.data?.items ?? []).map((f) => (
            <FailureItem key={`${f.kind}:${f.id}`} failure={f} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function FailureItem({ failure: f }: { failure: OpsFailure }) {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  return (
    <li className="space-y-1 rounded border border-slate-200 bg-white p-3" aria-label={f.label}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {KIND_LABELS[f.kind]}: {f.label}
        </span>
        <span className="text-xs text-slate-500">
          <Time value={f.occurredAt} />
        </span>
      </div>
      <p className="text-slate-600">
        {f.status}
        {f.detail === null ? "" : ` · ${f.detail}`}
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {f.replayable ? (
        <button
          type="button"
          disabled={busy}
          className="text-brand underline disabled:opacity-60"
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
        </button>
      ) : null}
    </li>
  );
}

function YouTubeCheck() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["ops", "youtube"],
    queryFn: ({ signal }) =>
      api<typeof ops.getYouTubeStatus>("GET", "/admin/integrations/youtube/status", { signal }),
  });
  const { busy, error, run } = useSubmit();
  const s = status.data?.status ?? null;
  return (
    <section
      aria-label="YouTube"
      className="space-y-1 rounded border border-slate-200 bg-white p-3 text-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">YouTube</h3>
        <button
          type="button"
          disabled={busy}
          className="text-brand underline disabled:opacity-60"
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
        </button>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {s === null ? (
        <p className="text-slate-600">Not checked yet.</p>
      ) : (
        <>
          <p className={s.ok ? "text-green-800" : "text-red-800"}>
            {s.ok ? "Working" : "Needs attention"} · checked <Time value={s.checkedAt} />
          </p>
          <p>
            Link checks (oEmbed): {s.reachable ? "reachable" : "unreachable"}
            {s.detail === null ? "" : ` · ${s.detail}`}
          </p>
          <ul>
            {s.channels.map((c) => (
              <li key={c.url} className="break-all">
                {c.resolves ? "✓" : "✗"} {c.url}
                {c.detail === null ? "" : ` · ${c.detail}`}
              </li>
            ))}
          </ul>
        </>
      )}
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
    <div className="space-y-4">
      <h1 className="text-title">Job queues</h1>
      <p className="text-sm text-slate-600">
        A queue whose oldest waiting job is over 2 minutes old is falling behind; you're emailed
        about it.
      </p>
      {list.isError ? <Alert tone="error">We couldn't load the queues.</Alert> : null}
      <div
        role="region"
        aria-label="Job queues"
        tabIndex={0}
        className="overflow-x-auto rounded border border-slate-200 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-2">Queue</th>
              <th className="p-2">Waiting</th>
              <th className="p-2">Running</th>
              <th className="p-2">Failed (24 h)</th>
              <th className="p-2">Oldest wait</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.items ?? []).map((q) => (
              <tr
                key={q.name}
                className={`border-t border-slate-100 ${q.behind ? "bg-red-50" : ""}`}
              >
                <td className="p-2 font-mono text-xs">{q.name}</td>
                <td className="p-2">{q.queued}</td>
                <td className="p-2">{q.active}</td>
                <td className="p-2">{q.failedLastDay}</td>
                <td className="p-2">
                  {q.oldestQueuedSeconds === null ? "–" : `${String(q.oldestQueuedSeconds)} s`}
                  {q.behind ? " · behind" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
