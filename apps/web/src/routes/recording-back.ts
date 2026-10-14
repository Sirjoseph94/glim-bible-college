import type { Me, VideoPlayback } from "@glim/contracts";
import type { DetailBar } from "../components/app/shell-parts";

/**
 * Where the recording page's back link goes (handoff §11.4): a student to the course's Recordings,
 * a Lecturer to the Recordings tab of the course they teach, anyone else home. Until the recording
 * loads, students go to My courses.
 */
export function recordingBack(
  playback: Pick<VideoPlayback, "courseOfferingId" | "courseCode" | "tracksProgress"> | undefined,
  roles: Pick<Me["roles"], "isStudent" | "isLecturer"> | undefined,
): DetailBar {
  if (playback === undefined)
    return roles?.isStudent === true
      ? { back: { to: "/courses", label: "My courses" } }
      : { back: { to: "/", label: "Home" } };
  const recordings = {
    params: { offeringId: playback.courseOfferingId },
    search: { tab: "recordings" },
    label: "Recordings",
  };
  // Only students entitled to the course keep progress.
  if (playback.tracksProgress)
    return { back: { to: "/courses/$offeringId", ...recordings }, code: playback.courseCode };
  if (roles?.isLecturer === true)
    return { back: { to: "/teach/$offeringId", ...recordings }, code: playback.courseCode };
  return { back: { to: "/", label: "Home" }, code: playback.courseCode };
}
