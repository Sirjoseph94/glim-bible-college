import type { DomainEvent, DomainEventName } from "@glim/contracts";

/** An idempotent reaction to a domain event (TRD §17.3). Delivery is at-least-once. */
export type Subscriber = (event: DomainEvent) => Promise<void>;

export type SubscriberRegistry = Partial<Record<DomainEventName, Subscriber[]>>;

/** Subscribers registered by modules. Ticket 02 has none; modules add theirs as they land. */
export const subscribers: SubscriberRegistry = {};

/** Runs every subscriber for the event; a failure fails the job so pg-boss retries it. */
export function createDispatcher(registry: SubscriberRegistry) {
  return async (event: DomainEvent): Promise<void> => {
    for (const subscriber of registry[event.name] ?? []) {
      await subscriber(event);
    }
  };
}
