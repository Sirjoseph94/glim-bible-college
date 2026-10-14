import { FakeLiveProvider } from "@glim/integrations/live-provider/fake";
import { MeetWorld } from "@glim/integrations/live-provider/world";
import type { MeetEventsService } from "@glim/modules/class-meeting";
import type { InboxService } from "@glim/modules/ops";
import { createLogger } from "@glim/telemetry";
import { describe, expect, it } from "vitest";
import { startEventPuller } from "./event-puller";

const logger = createLogger({ service: "test", level: "silent" });
const meetEvents = {
  toInbox: (e: { messageId: string }) => ({
    eventId: e.messageId,
    eventType: "X",
    subject: null,
    payload: e,
  }),
} as unknown as MeetEventsService;

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
}

describe("event puller (§11.8: ack only after the inbox commits)", () => {
  it("stores then acknowledges each batch", async () => {
    const world = new MeetWorld();
    const provider = new FakeLiveProvider(world);
    world.emit("CONFERENCE_STARTED", "host@glim.test", new Date(), { conferenceId: "c1" });
    world.emit("CONFERENCE_ENDED", "host@glim.test", new Date(), { conferenceId: "c1" });
    const stored: string[] = [];
    const inbox = {
      receive: (_p: string, events: { eventId: string }[]) => {
        stored.push(...events.map((e) => e.eventId));
        return Promise.resolve(events.length);
      },
    } as unknown as InboxService;
    const puller = startEventPuller({ provider, inbox, meetEvents, logger, idleMs: 5 });
    await until(() => world.pending.size === 0);
    await puller.stop();
    expect(stored).toHaveLength(2);
    expect(world.pending.size).toBe(0);
  });

  it("leaves messages unacknowledged when storing fails, so they come again", async () => {
    const world = new MeetWorld();
    const provider = new FakeLiveProvider(world);
    world.emit("CONFERENCE_STARTED", "host@glim.test", new Date(), { conferenceId: "c1" });
    let attempts = 0;
    const inbox = {
      receive: () => {
        attempts++;
        return Promise.reject(new Error("database down"));
      },
    } as unknown as InboxService;
    const puller = startEventPuller({ provider, inbox, meetEvents, logger, idleMs: 5 });
    await until(() => attempts >= 2);
    await puller.stop();
    expect(world.pending.size).toBe(1);
  });
});
