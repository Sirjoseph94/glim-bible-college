import { describe, expect, it } from "vitest";
import { CRON_SCHEDULES, ERROR_STATUS, QUEUES, isErrorCode, queuesForRole } from "./index";

describe("error codes", () => {
  it("map only to the HTTP statuses of the API conventions (§5.4) or 500", () => {
    const allowed = new Set([400, 401, 403, 404, 409, 412, 422, 429, 500, 503]);
    for (const [code, status] of Object.entries(ERROR_STATUS)) {
      expect(allowed.has(status), code).toBe(true);
    }
  });

  it("recognise known codes only", () => {
    expect(isErrorCode("ROOM_CONFLICT")).toBe(true);
    expect(isErrorCode("toString")).toBe(false);
  });
});

describe("queue registry", () => {
  it("routes queues to worker roles", () => {
    expect(queuesForRole("general")).toContain("admissions.offer-sweep");
    expect(queuesForRole("general")).not.toContain("auth.session-cleanup");
    expect(queuesForRole("scheduler")).toEqual([
      "db.logical-backup",
      "idempotency.cleanup",
      "auth.session-cleanup",
    ]);
    expect(queuesForRole("all")).toContain("recording.ingest");
    expect(queuesForRole("google")).toContain("class-meeting.provision");
    expect(queuesForRole("media")).toEqual(["recording.ingest"]);
  });

  it("schedules cron jobs only onto known queues", () => {
    for (const [name, spec] of Object.entries(CRON_SCHEDULES)) {
      expect(QUEUES[spec.queue], name).toBeDefined();
    }
  });
});
