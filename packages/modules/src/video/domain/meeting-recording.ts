/**
 * Which of a Class Meeting's videos its card shows, and as what (ui-overhaul #01), pure. Students
 * see a video as PUBLISHED only when they could play it now, and never learn of one they can't:
 * anything else is PROCESSING or nothing. People who manage the offering's videos see the rest.
 */

import type { MeetingRecordingStatus, VideoStatus } from "@glim/contracts";

export interface MeetingVideo {
  id: string;
  status: VideoStatus;
  /** The student playback rule (published, for enrolled students, released), evaluated in SQL. */
  studentVisible: boolean;
  createdAt: Date;
}

export interface MeetingRecording {
  videoId: string;
  status: MeetingRecordingStatus;
}

/** Best first; a status missing from a ranking is never shown to that viewer. */
const STUDENT_RANK: MeetingRecordingStatus[] = ["PUBLISHED", "PROCESSING"];
const MANAGER_RANK: MeetingRecordingStatus[] = [
  "PUBLISHED",
  "NOT_PUBLISHED",
  "PROCESSING",
  "FAILED",
];

function asSeenBy(video: MeetingVideo, manages: boolean): MeetingRecordingStatus | null {
  if (!manages) {
    if (video.studentVisible) return "PUBLISHED";
    return video.status === "PROCESSING" ? "PROCESSING" : null;
  }
  switch (video.status) {
    case "PUBLISHED":
      return "PUBLISHED";
    case "UNPUBLISHED":
      return "NOT_PUBLISHED";
    case "PROCESSING":
      return "PROCESSING";
    case "FAILED":
    case "UNAVAILABLE":
      return "FAILED";
    case "DELETED":
      return null;
  }
}

export function pickMeetingRecording(
  videos: readonly MeetingVideo[],
  manages: boolean,
): MeetingRecording | null {
  const rank = manages ? MANAGER_RANK : STUDENT_RANK;
  let best: { video: MeetingVideo; rank: number } | null = null;
  for (const video of videos) {
    const status = asSeenBy(video, manages);
    if (status === null) continue;
    const r = rank.indexOf(status);
    if (
      best === null ||
      r < best.rank ||
      (r === best.rank && video.createdAt.getTime() > best.video.createdAt.getTime())
    )
      best = { video, rank: r };
  }
  if (best === null) return null;
  const status = rank[best.rank];
  return status === undefined ? null : { videoId: best.video.id, status };
}
