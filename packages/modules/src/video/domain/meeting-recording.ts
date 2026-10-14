/**
 * Which of a Class Meeting's videos its card shows, and as what (ui-overhaul #01), pure. Students
 * see a video only if it's meant for them (for enrolled students, released): PUBLISHED when they
 * could play it now, PROCESSING while it gets there. Nothing hints at a video that isn't for them.
 * People who manage the offering's videos see the rest.
 */

import type { MeetingRecordingStatus, VideoStatus } from "@glim/contracts";

export interface MeetingVideo {
  id: string;
  status: VideoStatus;
  /** For enrolled students and released: the student rule apart from the status (in SQL). */
  forStudents: boolean;
  createdAt: Date;
}

export interface MeetingRecording {
  videoId: string;
  status: MeetingRecordingStatus;
}

/** How each viewer sees each video status, with its rank (lower is better); absent: not shown. */
type Seen = Partial<Record<VideoStatus, { status: MeetingRecordingStatus; rank: number }>>;

const STUDENT: Seen = {
  PUBLISHED: { status: "PUBLISHED", rank: 0 },
  PROCESSING: { status: "PROCESSING", rank: 1 },
};

const MANAGER: Seen = {
  PUBLISHED: { status: "PUBLISHED", rank: 0 },
  UNPUBLISHED: { status: "NOT_PUBLISHED", rank: 1 },
  PROCESSING: { status: "PROCESSING", rank: 2 },
  FAILED: { status: "FAILED", rank: 3 },
  UNAVAILABLE: { status: "FAILED", rank: 3 },
};

export function pickMeetingRecording(
  videos: readonly MeetingVideo[],
  manages: boolean,
): MeetingRecording | null {
  let best: { video: MeetingVideo; status: MeetingRecordingStatus; rank: number } | null = null;
  for (const video of videos) {
    if (!manages && !video.forStudents) continue;
    const seen = (manages ? MANAGER : STUDENT)[video.status];
    if (seen === undefined) continue;
    if (
      best === null ||
      seen.rank < best.rank ||
      (seen.rank === best.rank && video.createdAt.getTime() > best.video.createdAt.getTime())
    )
      best = { video, ...seen };
  }
  return best === null ? null : { videoId: best.video.id, status: best.status };
}
