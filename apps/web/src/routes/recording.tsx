import type { video, VideoPlayback } from "@glim/contracts";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { Alert } from "../components/form";
import { Icon } from "../design/icons";

/** The parts of the YouTube IFrame API the player uses. */
interface YouTubePlayer {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}

interface YouTubeApi {
  Player: new (
    element: HTMLIFrameElement,
    options: {
      events: {
        onReady?: (event: { target: YouTubePlayer }) => void;
        onStateChange?: (event: { data: number; target: YouTubePlayer }) => void;
        onError?: () => void;
      };
    },
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const IFRAME_API = "https://www.youtube.com/iframe_api";
const PLAYING = 1;
const PAUSED = 2;
const ENDED = 0;
const REPORT_EVERY_MS = 15_000;
const LOAD_TIMEOUT_MS = 20_000;

let apiLoading: Promise<YouTubeApi> | null = null;

/** Loads the IFrame API once, only when someone taps play (§13.4: it's a large download). */
function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player !== undefined) return Promise.resolve(window.YT);
  apiLoading ??= new Promise<YouTubeApi>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("timeout"));
    }, LOAD_TIMEOUT_MS);
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timer);
      if (window.YT === undefined) reject(new Error("no YT"));
      else resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = IFRAME_API;
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("blocked"));
    };
    document.head.append(script);
  }).catch((error: unknown) => {
    apiLoading = null;
    throw error;
  });
  return apiLoading;
}

/** "1:02:03" or "2:03". */
function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${String(h)}:${String(m).padStart(2, "0")}:${s}` : `${String(m)}:${s}`;
}

/** Rough data use at the two low settings (§13.4: ≈ 40 MB/hour at 144p, 70 MB/hour at 240p). */
function dataEstimate(durationMs: number | null): string | null {
  if (durationMs === null || durationMs <= 0) return null;
  const mb = (perHour: number) => Math.max(1, Math.round((perHour * durationMs) / 3_600_000));
  return `This recording (${clock(durationMs)}) uses about ${String(mb(40))} MB at 144p or ${String(mb(70))} MB at 240p.`;
}

/** Whether the browser asks for less data (Chrome's Data Saver / Lite mode). */
function saveData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

function DataSaverTip({ durationMs }: { durationMs: number | null }) {
  const estimate = dataEstimate(durationMs);
  return (
    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p>On mobile data, tap ⚙ → Quality → 144p (≈ 40 MB/hour) or 240p (≈ 70 MB/hour).</p>
      {estimate === null ? null : <p className="mt-1">{estimate}</p>}
    </div>
  );
}

/**
 * Sends the viewer's position (§13.4): every 15 s while playing, on pause, at the end and when
 * the page is hidden for good. Each report carries a rising `seq` so a late one is ignored.
 */
function useProgressReporter(videoId: string, enabled: boolean) {
  const seq = useRef(0);
  return (player: YouTubePlayer, leaving = false) => {
    if (!enabled) return;
    const durationMs = Math.round(player.getDuration() * 1000);
    if (durationMs <= 0) return;
    seq.current = Math.max(Date.now(), seq.current + 1);
    void api<typeof video.saveProgress>("PATCH", "/videos/:id/progress", {
      params: { id: videoId },
      body: {
        positionMs: Math.max(0, Math.round(player.getCurrentTime() * 1000)),
        durationMs,
        seq: seq.current,
      },
      keepalive: leaving,
    }).catch(() => undefined);
  };
}

function Player({ playback }: { playback: VideoPlayback }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [failed, setFailed] = useState(false);
  const report = useProgressReporter(playback.videoId, playback.tracksProgress);
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    let player: YouTubePlayer | null = null;
    let timer: number | undefined;
    let cancelled = false;
    const stopTimer = () => {
      window.clearInterval(timer);
      timer = undefined;
    };
    const onPageHide = () => {
      if (player !== null) reportRef.current(player, true);
    };
    loadYouTubeApi()
      .then((yt) => {
        if (cancelled || frame.current === null) return;
        player = new yt.Player(frame.current, {
          events: {
            onReady: ({ target }) => {
              // `start` in the embed URL resumes; seek too, in case the player ignored it.
              const resume = playback.resumeMs / 1000;
              if (resume > 0 && target.getCurrentTime() + 2 < resume) target.seekTo(resume, true);
            },
            onStateChange: ({ data, target }) => {
              if (data === PLAYING) {
                stopTimer();
                timer = window.setInterval(() => {
                  reportRef.current(target);
                }, REPORT_EVERY_MS);
              } else if (data === PAUSED || data === ENDED) {
                stopTimer();
                reportRef.current(target);
              }
            },
            onError: () => {
              setFailed(true);
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    window.addEventListener("pagehide", onPageHide);
    return () => {
      cancelled = true;
      stopTimer();
      window.removeEventListener("pagehide", onPageHide);
      if (player !== null) {
        reportRef.current(player);
        player.destroy();
      }
    };
  }, [playback.resumeMs]);

  const src = new URL(playback.embedUrl);
  // The tap that loaded the player starts it; the origin lets the IFrame API talk to it.
  src.searchParams.set("autoplay", "1");
  src.searchParams.set("origin", window.location.origin);
  return (
    <div className="space-y-2">
      <div className="glim-stage relative aspect-video w-full overflow-hidden rounded">
        <iframe
          ref={frame}
          title={playback.title}
          src={src.toString()}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          // YouTube refuses to play embeds that send no referrer; the app's default is none.
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
      {failed ? (
        <Alert tone="error">Can't reach YouTube — try another network or Wi-Fi.</Alert>
      ) : null}
    </div>
  );
}

/**
 * A recording (§13.4): a thumbnail and play button until the student taps it, then YouTube's
 * player, resuming where they stopped, with the data-saver tip.
 */
export function RecordingPage() {
  const { videoId } = useParams({ strict: false });
  const [started, setStarted] = useState(false);
  const playback = useQuery({
    queryKey: ["videos", videoId, "play"],
    queryFn: ({ signal }) =>
      api<typeof video.playVideo>("GET", "/videos/:id/play", {
        params: { id: videoId ?? "" },
        signal,
      }),
    staleTime: 0,
    refetchOnWindowFocus: false,
    enabled: videoId !== undefined,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  if (playback.isPending)
    return <div className="aspect-video animate-pulse rounded bg-slate-200" />;
  if (playback.isError)
    return (
      <Alert tone="error">
        {playback.error instanceof ApiError && playback.error.status === 404
          ? "This recording isn't available to you."
          : "We couldn't load this recording."}
      </Alert>
    );
  const p = playback.data;
  const dataSaver = saveData();
  return (
    <div className="space-y-3">
      <h1 className="text-title">{p.title}</h1>
      {dataSaver ? <DataSaverTip durationMs={p.durationMs} /> : null}
      {started ? (
        <Player playback={p} />
      ) : (
        <button
          type="button"
          className="glim-stage group relative block aspect-video w-full overflow-hidden rounded"
          onClick={() => {
            setStarted(true);
          }}
          aria-label={p.resumeMs > 0 ? `Resume from ${clock(p.resumeMs)}` : "Play recording"}
        >
          <img
            src={p.thumbnailUrl}
            alt=""
            width={320}
            height={180}
            className="h-full w-full object-cover opacity-90"
          />
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <span className="glim-stage-chip flex size-16 items-center justify-center rounded-pill">
              <Icon name="play" size={30} />
            </span>
            {p.resumeMs > 0 ? (
              <span className="rounded bg-black/70 px-2 py-0.5 text-sm">
                Resume from {clock(p.resumeMs)}
              </span>
            ) : null}
          </span>
        </button>
      )}
      {dataSaver ? null : <DataSaverTip durationMs={p.durationMs} />}
    </div>
  );
}
