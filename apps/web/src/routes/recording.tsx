import type { video, VideoPlayback } from "@glim/contracts";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { meQuery } from "../api/session";
import { useDetailBar } from "../components/app/shell-parts";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { isNotAvailable, LoadFailed, NotAvailable } from "../components/app/page-states";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
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

/** The low-data tip (§13.4, decision UI-Q2: YouTube's own quality menu, no audio-only). */
function DataSaverTip({ durationMs }: { durationMs: number | null }) {
  const estimate = dataEstimate(durationMs);
  return (
    <Banner tone="info" title="Save data on mobile">
      <p>
        In the player, tap{" "}
        <span className="inline-flex translate-y-0.5">
          <Icon name="settings" size={16} label="Settings" />
        </span>{" "}
        → Quality → 144p (≈ 40 MB per hour) or 240p (≈ 70 MB per hour).
      </p>
      {estimate === null ? null : <p className="mt-1">{estimate}</p>}
    </Banner>
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

function Player({ playback, onRetry }: { playback: VideoPlayback; onRetry: () => void }) {
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
    <div className="space-y-3">
      <div className="glim-stage relative aspect-video w-full overflow-hidden md:rounded-lg">
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
        <Banner
          tone="danger"
          title="This recording didn't load"
          action={
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          }
        >
          Can't reach YouTube. Try another network or Wi-Fi, or choose a lower quality in the
          player.
        </Banner>
      ) : null}
    </div>
  );
}

/**
 * A recording (§11.4, §13.4; decision UI-Q2): the thumbnail and a play button until the student
 * taps it (YouTube's player is a large download), then YouTube's player, resuming where they
 * stopped, with the data-saver tip first when the browser asks to save data.
 */
export function RecordingPage() {
  const { videoId } = useParams({ strict: false });
  const me = useQuery(meQuery);
  const [started, setStarted] = useState(false);
  // Remounts the player for "Try again" after YouTube failed to load.
  const [attempt, setAttempt] = useState(0);
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
  // Playback doesn't say which course it belongs to, so students go back to My courses.
  useDetailBar(
    me.data?.roles.isStudent
      ? { back: { to: "/courses", label: "My courses" } }
      : { back: { to: "/", label: "Home" } },
  );
  if (playback.isPending)
    return (
      <SkeletonGroup label="Loading the recording">
        <Skeleton className="aspect-video w-full" />
        <Skeleton className="h-6 w-2/3" />
      </SkeletonGroup>
    );
  if (playback.isError)
    return isNotAvailable(playback.error) ? (
      <NotAvailable />
    ) : (
      <LoadFailed what="this recording" onRetry={() => void playback.refetch()} />
    );
  const p = playback.data;
  const dataSaver = saveData();
  const length = p.durationMs === null ? null : clock(p.durationMs);
  return (
    <div className="space-y-4">
      {dataSaver ? <DataSaverTip durationMs={p.durationMs} /> : null}
      {started ? (
        <Player
          key={attempt}
          playback={p}
          onRetry={() => {
            setAttempt((n) => n + 1);
          }}
        />
      ) : (
        <button
          type="button"
          className="glim-stage group relative block aspect-video w-full overflow-hidden md:rounded-lg"
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
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="glim-stage-chip flex size-16 items-center justify-center rounded-pill transition-colors duration-120 group-hover:bg-transparent">
              <Icon name="play" size={30} />
            </span>
          </span>
        </button>
      )}
      <div className="space-y-1">
        <h1 className="text-title">{p.title}</h1>
        {length ? <p className="text-body-sm text-ink-muted">{length}</p> : null}
      </div>
      {p.resumeMs > 0 && !started ? (
        <Banner tone="info" title={`You stopped at ${clock(p.resumeMs)}`}>
          Tap play to carry on from there.
        </Banner>
      ) : null}
      {dataSaver ? null : <DataSaverTip durationMs={p.durationMs} />}
    </div>
  );
}
