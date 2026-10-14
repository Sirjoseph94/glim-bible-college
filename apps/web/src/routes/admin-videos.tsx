import type { AdminVideo, offerings, video } from "@glim/contracts";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { formText } from "../components/form";
import { Time } from "../components/time";
import { Badge, type Tone } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button, buttonClass } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/dialog";
import { EmptyState } from "../components/ui/empty-state";
import { Select, TextField } from "../components/ui/field";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { useSubmit } from "../components/use-submit";

const STATUSES = ["", "UNAVAILABLE", "PUBLISHED", "UNPUBLISHED", "DELETED"] as const;
const ORIGINS = ["", "LINK", "RECORDING"] as const;

const STATUS: Record<AdminVideo["status"], { tone: Tone; word: string }> = {
  PROCESSING: { tone: "warning", word: "Processing" },
  UNPUBLISHED: { tone: "neutral", word: "Unpublished" },
  PUBLISHED: { tone: "success", word: "Published" },
  UNAVAILABLE: { tone: "danger", word: "Unavailable on YouTube" },
  FAILED: { tone: "danger", word: "Failed" },
  DELETED: { tone: "neutral", word: "Deleted" },
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
  const filters = { offeringId, status, origin };
  const list = useInfiniteQuery({
    queryKey: ["admin", "videos", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api<typeof video.listAdminVideos>("GET", "/admin/videos", {
        query: { offeringId, status, origin, cursor: pageParam, limit: 50 },
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const offeringList = useQuery({
    queryKey: ["offerings", "all"],
    queryFn: ({ signal }) =>
      api<typeof offerings.listOfferings>("GET", "/course-offerings", { signal }),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Videos" meta="Every video across the college, unavailable ones first." />
      <div className="grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <Select
            label="Offering"
            value={offeringId}
            onChange={(e) => {
              setOfferingId(e.target.value);
            }}
          >
            <option value="">All offerings</option>
            {(offeringList.data?.items ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.courseCode} {o.title} ({o.semesterName}, {o.sessionCode})
              </option>
            ))}
          </Select>
        </div>
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as (typeof STATUSES)[number]);
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "" ? "Any status" : STATUS[s].word}
            </option>
          ))}
        </Select>
        <Select
          label="Origin"
          value={origin}
          onChange={(e) => {
            setOrigin(e.target.value as (typeof ORIGINS)[number]);
          }}
        >
          {ORIGINS.map((o) => (
            <option key={o} value={o}>
              {o === "" ? "Any origin" : o === "LINK" ? "Added by link" : "Meet recording"}
            </option>
          ))}
        </Select>
      </div>
      {list.isPending ? (
        <SkeletonGroup label="Loading videos">
          <Skeleton className="h-48" />
        </SkeletonGroup>
      ) : list.isError ? (
        <LoadFailed what="the videos" onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="video" title="No videos match">
          Try another offering, status or origin.
        </EmptyState>
      ) : (
        <>
          <Card list role="list">
            {items.map((v) => (
              <VideoRow key={v.id} video={v} />
            ))}
          </Card>
          {list.hasNextPage ? (
            <Button
              variant="secondary"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Show more
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Where a Meet recording's upload to YouTube is (integration slice). */
const INGEST: Record<NonNullable<AdminVideo["ingest"]>["status"], string> = {
  DISCOVERED: "Waiting to upload to YouTube.",
  UPLOADING: "Uploading to YouTube…",
  PROCESSING: "YouTube is processing it.",
  READY: "On YouTube.",
  FAILED: "The upload failed.",
  SOURCE_MISSING: "The recording is gone from Google Drive; it can't be uploaded.",
};

function VideoRow({ video: v }: { video: AdminVideo }) {
  const queryClient = useQueryClient();
  const { busy, problem, fieldErrors, run } = useSubmit();
  const [doing, setDoing] = useState<"recheck" | "restore" | "replace" | "retry" | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "videos"] });
  const act = (which: NonNullable<typeof doing>, action: () => Promise<unknown>) => {
    setDoing(which);
    return run(async () => {
      await action();
      await refresh();
    });
  };
  const params = { id: v.id };
  const deleted = v.status === "DELETED";
  const unavailable = v.status === "UNAVAILABLE";
  // A Meet recording still on its way to YouTube has nothing to watch or check yet.
  const onYouTube = v.youtubeVideoId !== null && v.status !== "PROCESSING";

  return (
    <div role="listitem" aria-label={v.title} className="space-y-3 px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-subhead">{v.title}</p>
        <p className="text-body-sm">
          <Badge tone={STATUS[v.status].tone}>{STATUS[v.status].word}</Badge>
          {unavailable && v.unavailableReason !== null ? (
            <span className="text-danger">{` (${REASON[v.unavailableReason] ?? v.unavailableReason})`}</span>
          ) : null}
        </p>
      </div>
      <p className="text-meta text-ink-muted">
        {v.courseCode} {v.courseTitle} · {v.semesterName}, {v.sessionCode}
        {v.lastCheckedAt === null ? null : (
          <>
            {" "}
            · checked <Time value={v.lastCheckedAt} />
          </>
        )}
      </p>
      {v.ingest !== null && v.status !== "PUBLISHED" && v.status !== "UNPUBLISHED" ? (
        <p className="text-body-sm">
          {INGEST[v.ingest.status]}
          {v.ingest.error ? <span className="text-ink-muted">{` ${v.ingest.error}`}</span> : null}
        </p>
      ) : null}
      {deleted && v.deleteAfter !== null ? (
        v.youtubeDeleteRemindedAt === null ? (
          <p className="text-body-sm">
            Can be restored until <Time value={v.deleteAfter} />.
          </p>
        ) : (
          <Banner tone="warning">
            If it's still on YouTube, delete it in YouTube Studio: anyone with its link can watch it
            there.
          </Banner>
        )
      ) : null}
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {v.studioUrl === null ? null : (
          <a
            href={v.studioUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            YouTube Studio
          </a>
        )}
        {v.status === "FAILED" && v.ingest !== null && v.ingest.status === "FAILED" ? (
          <Button
            variant="primary"
            size="sm"
            loading={busy && doing === "retry"}
            disabled={busy && doing !== "retry"}
            onClick={() =>
              void act("retry", () =>
                api<typeof video.retryIngest>("POST", "/videos/:id/retry-ingest", { params }),
              )
            }
          >
            Upload again
          </Button>
        ) : null}
        {deleted || !onYouTube ? null : (
          <Link
            to="/recordings/$videoId"
            params={{ videoId: v.id }}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            Watch
          </Link>
        )}
        {deleted ? (
          v.youtubeDeleteRemindedAt === null ? (
            <Button
              variant="secondary"
              size="sm"
              loading={busy && doing === "restore"}
              disabled={busy && doing !== "restore"}
              onClick={() =>
                void act("restore", () =>
                  api<typeof video.restoreVideo>("POST", "/videos/:id/restore", { params }),
                )
              }
            >
              Restore
            </Button>
          ) : null
        ) : !onYouTube ? null : (
          <>
            <Button
              variant="secondary"
              size="sm"
              loading={busy && doing === "recheck"}
              disabled={busy && doing !== "recheck"}
              onClick={() =>
                void act("recheck", () =>
                  api<typeof video.recheckVideo>("POST", "/videos/:id/recheck", { params }),
                )
              }
            >
              Recheck
            </Button>
            <Button
              variant="quiet"
              size="sm"
              aria-expanded={replacing}
              onClick={() => {
                setReplacing(!replacing);
              }}
            >
              Replace link
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => {
                setDeleting(true);
              }}
            >
              Delete
            </Button>
          </>
        )}
      </div>
      {replacing && !deleted ? (
        <form
          className="flex flex-col gap-3 md:flex-row md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const youtubeUrl = formText(new FormData(e.currentTarget), "youtubeUrl");
            void act("replace", async () => {
              await api<typeof video.replaceVideoLink>("PUT", "/videos/:id/youtube-link", {
                params,
                body: { youtubeUrl },
              });
              setReplacing(false);
            });
          }}
        >
          <div className="min-w-0 flex-1">
            <TextField
              name="youtubeUrl"
              label="New YouTube link"
              required
              error={fieldErrors.youtubeUrl}
            />
          </div>
          <Button type="submit" variant="primary" loading={busy && doing === "replace"}>
            Replace
          </Button>
        </form>
      ) : null}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete "${v.title}"?`}
        confirmLabel="Delete video"
        tone="danger"
        onConfirm={async () => {
          await api<typeof video.deleteVideo>("DELETE", "/videos/:id", { params });
          setDeleting(false);
          await refresh();
        }}
      >
        It is hidden from students at once. You can restore it for 7 days.
      </ConfirmDialog>
    </div>
  );
}
