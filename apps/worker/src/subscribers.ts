import type { DomainEvent, DomainEventName } from "@glim/contracts";
import { Db } from "@glim/db";
import type { INestApplicationContext } from "@nestjs/common";

/** An idempotent reaction to a domain event (TRD §17.3). Delivery is at-least-once. */
export type Subscriber = (event: DomainEvent) => Promise<void>;

export type SubscriberRegistry = Partial<Record<DomainEventName, Subscriber[]>>;

/**
 * Subscribers for the modules' domain events. Long work is handed to its own queue rather than
 * done in the subscriber, so it gets that queue's retry and expiry (§17.2).
 */
export function createSubscribers(context: INestApplicationContext): SubscriberRegistry {
  const db = context.get(Db);
  return {
    // Compulsory courses are registered when a semester opens registration (§9.3).
    "academic.semester.registration-opened": [
      async (event) => {
        const { semesterId } = event.payload as { semesterId: string };
        await db.withTx(({ boss }) => boss.send("semester.open-registration", { semesterId }));
      },
    ],
  };
}

/** Runs every subscriber for the event; a failure fails the job so pg-boss retries it. */
export function createDispatcher(registry: SubscriberRegistry) {
  return async (event: DomainEvent): Promise<void> => {
    for (const subscriber of registry[event.name] ?? []) {
      await subscriber(event);
    }
  };
}
