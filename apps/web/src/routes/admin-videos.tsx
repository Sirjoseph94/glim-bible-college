import type { AdminVideo, offerings, video } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api/client";
import { Alert, formText } from "../components/form";
import { Time } from "../components/time";
import { useSubmit } from "../components/use-submit";

const STATUSES = ["", "UNAVAILABLE", "PUBLISHED", "UNPUBLISHED", "DELETED"] as const;
const ORIGINS = ["", "LINK", "RECORDING"] as const;

const STATUS_LABEL: Record<AdminVideo["status"], string> = {
  PROCESSING: "Processing",
  UNPUBLISHED: "Unpublished",
  PUBLISHED: "Published",
  UNAVAILABLE: "Unavailable on YouTube",
  FAILED: "Failed",
  DELETED: "Deleted",
};

const REASON: Record<string, string> = {
  NOT_FOUND: "deleted or removed on YouTube",
  PRIVATE_OR_RESTRICTED: "private on YouTube",
};

/**
 * Every video across offerings (TRD §13.6), unavailable ones first: recheck, replace the link,
 * delete with a 7-day restore, and the YouTube Studio page for each.
 */
export function AdminVideosPage() {
  const [offeringId, setOfferingId] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("");
  const [origin, setOrigin] = useState<(typeof ORIGINS)[number]>("");
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const filters = { offeringId, status, origin, cursor };
  const list = useQuery({
    queryKey: ["admin", "videos", filters],
    queryFn: ({ signal }) =>
      api<typeof video.listAdminVideos>("GET", "/admin/videos", {
        query: { offeringId, status, origin, cursor, limit: 50 },
        signal,
      }),
  });
  const offeringList = useQuery({
    queryKey: ["offerings", "all"],
    queryFn: ({ signal }) =>
      api<typeof offerings.listOfferings>("GET", "/course-offerings", { signal }),
  });
  const reset = () => {
    setCursors([]);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Videos</h2>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Offering"
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-2"
          value={offeringId}
          onChange={(e) => {
            setOfferingId(e.target.value);
            reset();
          }}
        >
          <option value="">All offerings</option>
          {(offeringList.data?.items ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.courseCode} {o.title} ({o.semesterName}, {o.sessionCode})
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          className="rounded border border-slate-300 px-2 py-2"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as (typeof STATUSES)[number]);
            reset();
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "" ? "Any status" : STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="Origin"
          className="rounded border border-slate-300 px-2 py-2"
          value={origin}
          onChange={(e) => {
            setOrigin(e.target.value as (typeof ORIGINS)[number]);
            reset();
          }}
        >
          {ORIGINS.map((o) => (
            <option key={o} value={o}>
              {o === "" ? "Any origin" : o === "LINK" ? "Added by link" : "Meet recording"}
            </option>
          ))}
        </select>
      </div>
      {list.isPending ? (
        <div className="h-24 animate-pulse rounded bg-slate-200" />
      ) : list.isError ? (
        <Alert tone="error">{list.error.message}</Alert>
      ) : (
        <>
          <ul className="space-y-2">
            {list.data.items.map((v) => (
              <VideoRow key={v.id} video={v} />
            ))}
            {list.data.items.length === 0 ? (
              <li className="text-slate-500">No videos match.</li>
            ) : null}
          </ul>
          <div className="flex gap-2">
            {cursors.length > 0 ? (
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setCursors(cursors.slice(0, -1));
                }}
              >
                Previous
              </button>
            ) : null}
            {list.data.nextCursor !== null ? (
              <button
                type="button"
                className="underline"
                onClick={() => {
                  if (list.data.nextCursor !== null) setCursors([...cursors, list.data.nextCursor]);
                }}
              >
                Next
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function VideoRow({ video: v }: { video: AdminVideo }) {
  const queryClient = useQueryClient();
  const { busy, error, fieldErrors, run } = useSubmit();
  const [replacing, setReplacing] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "videos"] });
  const act = (action: () => Promise<unknown>) =>
    run(async () => {
      await action();
      await refresh();
    });
  const params = { id: v.id };
  const deleted = v.status === "DELETED";

  return (
    <li
      className={`space-y-2 rounded border bg-white p-3 ${
        v.status === "UNAVAILABLE" ? "border-red-300" : "border-slate-200"
      }`}
      aria-label={v.title}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{v.title}</span>
        <span
          className={`text-sm ${v.status === "UNAVAILABLE" ? "text-red-700" : "text-slate-600"}`}
        >
          {STATUS_LABEL[v.status]}
          {v.status === "UNAVAILABLE" && v.unavailableReason !== null
            ? ` (${REASON[v.unavailableReason] ?? v.unavailableReason})`
            : null}
        </span>
      </div>
      <div className="text-sm text-slate-600">
        {v.courseCode} {v.courseTitle} · {v.semesterName}, {v.sessionCode}
        {v.lastCheckedAt === null ? null : (
          <>
            {" "}
            · checked <Time value={v.lastCheckedAt} />
          </>
        )}
      </div>
      {deleted && v.deleteAfter !== null ? (
        <p className="text-sm text-slate-700">
          {v.youtubeDeleteRemindedAt === null ? (
            <>
              Can be restored until <Time value={v.deleteAfter} />.
            </>
          ) : (
            "Delete it in YouTube Studio too: anyone with its link can still watch it there."
          )}
        </p>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap gap-3 text-sm">
        {v.studioUrl === null ? null : (
          <a
            href={v.studioUrl}
            target="_blank"
            rel="noreferrer"
            className="text-blue-700 underline"
          >
            YouTube Studio
          </a>
        )}
        {deleted ? null : (
          <Link
            to="/recordings/$videoId"
            params={{ videoId: v.id }}
            className="text-blue-700 underline"
          >
            Watch
          </Link>
        )}
        {deleted ? (
          v.youtubeDeleteRemindedAt === null ? (
            <button
              type="button"
              disabled={busy}
              className="underline"
              onClick={() =>
                void act(() =>
                  api<typeof video.restoreVideo>("POST", "/videos/:id/restore", { params }),
                )
              }
            >
              Restore
            </button>
          ) : null
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              className="underline"
              onClick={() =>
                void act(() =>
                  api<typeof video.recheckVideo>("POST", "/videos/:id/recheck", { params }),
                )
              }
            >
              Recheck
            </button>
            <button
              type="button"
              className="underline"
              onClick={() => {
                setReplacing(!replacing);
              }}
            >
              Replace link
            </button>
            <button
              type="button"
              disabled={busy}
              className="text-red-700 underline"
              onClick={() => {
                if (!window.confirm(`Delete "${v.title}"? You can restore it for 7 days.`)) return;
                void act(() => api<typeof video.deleteVideo>("DELETE", "/videos/:id", { params }));
              }}
            >
              Delete
            </button>
          </>
        )}
      </div>
      {replacing && !deleted ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const youtubeUrl = formText(new FormData(e.currentTarget), "youtubeUrl");
            void act(async () => {
              await api<typeof video.replaceVideoLink>("PUT", "/videos/:id/youtube-link", {
                params,
                body: { youtubeUrl },
              });
              setReplacing(false);
            });
          }}
        >
          <label className="min-w-0 flex-1 space-y-1 text-sm">
            <span className="block font-medium text-slate-700">New YouTube link</span>
            <input
              name="youtubeUrl"
              required
              className="w-full rounded border border-slate-300 px-3 py-2"
              aria-invalid={fieldErrors.youtubeUrl === undefined ? undefined : true}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-brand px-3 py-2 text-white disabled:opacity-60"
          >
            Replace
          </button>
        </form>
      ) : null}
    </li>
  );
}
