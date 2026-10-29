import { exportPKCS8, generateKeyPair } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveProviderContract } from "../live-provider/contract";
import {
  ProviderPermanentError,
  ProviderRateLimitedError,
  ProviderUnavailableError,
} from "../live-provider/port";
import { MeetWorld } from "../live-provider/world";
import { CircuitBreaker } from "./breaker";
import { GoogleRateLimiter } from "./limiter";
import { GoogleMeetProvider } from "./meet-provider";
import { FakeGoogleServer } from "./testing/fake-google-server";

const HOST = "lms-host-01@glim.test";
const SETTINGS = {
  accessType: "RESTRICTED",
  moderation: true,
  presentRestriction: "HOSTS_ONLY",
  autoRecording: true,
} as const;

let privateKey: string;

beforeAll(async () => {
  const { privateKey: key } = await generateKeyPair("RS256", { extractable: true });
  privateKey = await exportPKCS8(key);
});

async function subject(options: { sleeps?: number[]; limiter?: GoogleRateLimiter } = {}) {
  const server = await new FakeGoogleServer(new MeetWorld()).start();
  const provider = new GoogleMeetProvider({
    serviceAccount: { clientEmail: "glim-meet@glim-lms.iam.gserviceaccount.com", privateKey },
    pubsubSubscription: "projects/glim-lms/subscriptions/glim-meet-events-pull",
    pubsubTopic: "projects/glim-lms/topics/glim-meet-events",
    endpoints: server.endpoints,
    sleep: (ms) => {
      options.sleeps?.push(ms);
      return Promise.resolve();
    },
    random: () => 0.5,
    operationPollMs: 0,
    ...(options.limiter === undefined ? {} : { limiter: options.limiter }),
  });
  return { server, provider, world: server.world };
}

liveProviderContract("GoogleMeetProvider over HTTP", async () => {
  const { server, provider, world } = await subject();
  return { provider, world, close: () => server.stop() };
});

describe("GoogleMeetProvider: Google specifics (TRD §11.3, §11.7)", () => {
  let s: Awaited<ReturnType<typeof subject>>;
  const sleeps: number[] = [];
  beforeAll(async () => {
    s = await subject({ sleeps });
  });
  afterAll(() => s.server.stop());

  it("acts as the host through domain-wide delegation, and Pub/Sub as itself", async () => {
    s.server.lastSubjects = [];
    await s.provider.provisionSpace({ hostEmail: HOST, settings: SETTINGS });
    await s.provider.pullEvents(1);
    expect(s.server.lastSubjects).toEqual([HOST, null]);
  });

  it("caches tokens per user and scopes, and refreshes once on a 401", async () => {
    const before = s.server.tokensIssued;
    const { spaceId } = await s.provider.provisionSpace({ hostEmail: HOST, settings: SETTINGS });
    await s.provider.getSpaceStatus({ hostEmail: HOST, spaceId });
    expect(s.server.tokensIssued).toBe(before);
    s.server.revokeTokens();
    await s.provider.getSpaceStatus({ hostEmail: HOST, spaceId });
    expect(s.server.tokensIssued).toBe(before + 1);
  });

  it("honours Retry-After on a 429 and backs off with jitter on a 503", async () => {
    sleeps.length = 0;
    s.server.respond(
      "getSpaceStatus",
      { status: 429, headers: { "retry-after": "7" } },
      { status: 503 },
    );
    const { spaceId } = await s.provider.provisionSpace({ hostEmail: HOST, settings: SETTINGS });
    await s.provider.getSpaceStatus({ hostEmail: HOST, spaceId });
    // 7 s from the header, then full jitter: random 0.5 × min(60 s, 1 s × 2²).
    expect(sleeps).toEqual([7000, 2000]);
  });

  it("turns attendance reports off where the edition has them", async () => {
    s.server.spaceConfigs = [];
    await s.provider.provisionSpace({ hostEmail: HOST, settings: SETTINGS });
    expect(s.server.spaceConfigs).toHaveLength(1);
    expect(s.server.spaceConfigs[0]).toMatchObject({
      attendanceReportGenerationType: "DO_NOT_GENERATE",
    });
  });

  it("creates the space without the attendance-report setting where the edition refuses it", async () => {
    s.server.spaceConfigs = [];
    s.server.attendanceReportsUnavailable = true;
    try {
      const space = await s.provider.provisionSpace({ hostEmail: HOST, settings: SETTINGS });
      expect(space.joinUrl).toMatch(/^https:/);
      expect(s.server.spaceConfigs).toHaveLength(2);
      expect(s.server.spaceConfigs[1]).not.toHaveProperty("attendanceReportGenerationType");
      expect(s.server.spaceConfigs[1]).toMatchObject({ accessType: "RESTRICTED" });
    } finally {
      s.server.attendanceReportsUnavailable = false;
    }
  });

  it("doesn't retry other refusals to create a space", async () => {
    s.server.spaceConfigs = [];
    s.server.respond("provisionSpace", { status: 403 });
    await expect(
      s.provider.provisionSpace({ hostEmail: HOST, settings: SETTINGS }),
    ).rejects.toBeInstanceOf(ProviderPermanentError);
    expect(s.server.spaceConfigs).toHaveLength(0);
  });

  it("treats a token refused by Google (DWD scopes not granted) as permanent", async () => {
    s.server.revokeTokens();
    s.world.failNext("token", "permanent");
    await expect(
      s.provider.provisionSpace({ hostEmail: "other@glim.test", settings: SETTINGS }),
    ).rejects.toBeInstanceOf(ProviderPermanentError);
  });

  it("pages through participants and their sessions", async () => {
    const { spaceId } = await s.provider.provisionSpace({ hostEmail: HOST, settings: SETTINGS });
    const conferenceId = s.world.startConference(spaceId, new Date("2026-11-02T09:00:00Z"));
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 3; j++)
        s.world.addSession(conferenceId, {
          participantId: `p${String(i)}`,
          providerUserId: `users/${String(i)}`,
          displayName: `Student ${String(i)}`,
          startedAt: new Date(Date.UTC(2026, 10, 2, 9, j * 10)),
          endedAt: new Date(Date.UTC(2026, 10, 2, 9, j * 10 + 5)),
        });
    const sessions = [];
    for await (const x of s.provider.listParticipantSessions({ hostEmail: HOST, conferenceId }))
      sessions.push(x);
    expect(sessions).toHaveLength(15);
    expect(new Set(sessions.map((x) => x.participantId)).size).toBe(5);
  });
});

describe("GoogleRateLimiter", () => {
  it("waits out a short refill and reschedules a long one", async () => {
    const waits = [500, 0, 0, 60_000];
    const slept: number[] = [];
    const limiter = new GoogleRateLimiter(() => Promise.resolve(waits.shift() ?? 0), {
      maxWaitMs: 10_000,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });
    await limiter.take("create", HOST);
    expect(slept).toEqual([500]);
    await expect(limiter.take("create", HOST)).rejects.toBeInstanceOf(ProviderRateLimitedError);
  });

  it("checks the per-user and per-project buckets at 80 % of quota", async () => {
    const asked: [string, number, number][] = [];
    const limiter = new GoogleRateLimiter((key, capacity, refill) => {
      asked.push([key, capacity, refill]);
      return Promise.resolve(0);
    });
    await limiter.take("write", "Lms-Host-01@glim.test");
    expect(asked).toEqual([
      ["google:write:user:lms-host-01@glim.test", 80, 80 / 60],
      ["google:write:project", 800, 800 / 60],
    ]);
  });

  it("is consulted before Meet calls", async () => {
    const keys: string[] = [];
    const t = await subject({
      limiter: new GoogleRateLimiter((key) => {
        keys.push(key);
        return Promise.resolve(0);
      }),
    });
    await t.provider.provisionSpace({ hostEmail: HOST, settings: SETTINGS });
    await t.server.stop();
    expect(keys).toContain(`google:create:user:${HOST}`);
  });
});

describe("CircuitBreaker", () => {
  it("opens after 5 failures within 30 s, then lets one probe through every 30 s", () => {
    let now = 0;
    const breaker = new CircuitBreaker(() => now);
    for (let i = 0; i < 4; i++) breaker.failure();
    expect(breaker.state).toBe("CLOSED");
    breaker.failure();
    expect(breaker.state).toBe("OPEN");
    expect(breaker.admit()).toBe(30_000);
    now = 30_000;
    expect(breaker.state).toBe("HALF_OPEN");
    expect(breaker.admit()).toBe(0);
    expect(breaker.admit()).toBeGreaterThan(0);
    breaker.failure();
    expect(breaker.state).toBe("OPEN");
    now = 60_000;
    expect(breaker.admit()).toBe(0);
    breaker.success();
    expect(breaker.state).toBe("CLOSED");
  });

  it("forgets failures older than 30 s", () => {
    let now = 0;
    const breaker = new CircuitBreaker(() => now);
    for (let i = 0; i < 4; i++) breaker.failure();
    now = 31_000;
    breaker.failure();
    expect(breaker.state).toBe("CLOSED");
  });

  it("fails calls fast while open", async () => {
    const t = await subject();
    t.world.failNext("getSpaceStatus", "unavailable", 25);
    const ref = { hostEmail: HOST, spaceId: "x" };
    for (let i = 0; i < 5; i++)
      await expect(t.provider.getSpaceStatus(ref)).rejects.toBeInstanceOf(ProviderUnavailableError);
    const requests = t.server.requests.length;
    await expect(t.provider.getSpaceStatus(ref)).rejects.toThrow(/paused/);
    expect(t.server.requests.length).toBe(requests);
    expect(t.provider.circuitStates()[HOST]).toBe("OPEN");
    await t.server.stop();
  });
});
