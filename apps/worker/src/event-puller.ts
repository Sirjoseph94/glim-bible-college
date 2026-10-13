import type { LiveProvider } from "@glim/integrations/live-provider/port";
import type { MeetEventsService } from "@glim/modules/class-meeting";
import type { InboxService } from "@glim/modules/ops";
import type { Logger } from "@glim/telemetry";

export interface EventPullerOptions {
  provider: LiveProvider;
  inbox: InboxService;
  meetEvents: MeetEventsService;
  logger: Logger;
  /** Messages per pull. */
  batchSize?: number;
  /** Wait after an empty pull or an error. */
  idleMs?: number;
}

/**
 * The Pub/Sub pull subscriber (TRD §11.8, v2-18): each batch is stored in the inbox, and only
 * acknowledged once that transaction committed, so a crash in between means redelivery, never
 * loss. Duplicates are ignored by the inbox. Processing happens in `provider-event.process`.
 */
export function startEventPuller(options: EventPullerOptions): { stop(): Promise<void> } {
  const { provider, inbox, meetEvents, logger } = options;
  const batchSize = options.batchSize ?? 50;
  const idleMs = options.idleMs ?? 2000;
  const state = { running: true };
  let wake: (() => void) | null = null;
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  const loop = (async () => {
    while (state.running) {
      try {
        const pulled = await provider.pullEvents(batchSize);
        if (pulled.length === 0) {
          await pause(idleMs);
          continue;
        }
        const stored = await inbox.receive(
          "google_meet",
          pulled.map((p) => meetEvents.toInbox(p.envelope)),
        );
        await provider.ackEvents(pulled.map((p) => p.ackId));
        logger.debug({ pulled: pulled.length, stored }, "meet events pulled");
      } catch (error) {
        logger.warn({ err: error }, "pulling meet events failed");
        await pause(idleMs);
      }
    }
  })();

  return {
    stop: async () => {
      state.running = false;
      wake?.();
      await loop;
    },
  };
}
