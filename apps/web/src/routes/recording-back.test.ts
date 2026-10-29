import { describe, expect, it } from "vitest";
import { recordingBack } from "./recording-back";

const playback = { courseOfferingId: "o1", courseCode: "PBIB101", tracksProgress: true };
const roles = { isStudent: true, isLecturer: false };

describe("recordingBack (handoff §11.4)", () => {
  it("takes a student back to the course's recordings, with its code", () => {
    expect(recordingBack(playback, roles)).toEqual({
      back: {
        to: "/courses/$offeringId",
        params: { offeringId: "o1" },
        search: { tab: "recordings" },
        label: "Recordings",
      },
      code: "PBIB101",
    });
  });

  it("takes a Lecturer back to the recordings tab of the course they teach", () => {
    expect(
      recordingBack({ ...playback, tracksProgress: false }, { isStudent: false, isLecturer: true }),
    ).toEqual({
      back: {
        to: "/teach/$offeringId",
        params: { offeringId: "o1" },
        search: { tab: "recordings" },
        label: "Recordings",
      },
      code: "PBIB101",
    });
  });

  it("takes anyone else home", () => {
    expect(
      recordingBack(
        { ...playback, tracksProgress: false },
        { isStudent: false, isLecturer: false },
      ),
    ).toEqual({ back: { to: "/", label: "Home" }, code: "PBIB101" });
  });

  it("goes to My courses or Home before the recording has loaded", () => {
    expect(recordingBack(undefined, roles)).toEqual({
      back: { to: "/courses", label: "My courses" },
    });
    expect(recordingBack(undefined, undefined)).toEqual({ back: { to: "/", label: "Home" } });
  });
});
