import type { DomainEvent, QueueName } from "@glim/contracts";
import { IntakesService, OffersService } from "@glim/modules/admissions";
import { SessionService } from "@glim/modules/identity";
import { NotificationsService } from "@glim/modules/notifications";
import { BackupService } from "@glim/modules/ops";
import type { INestApplicationContext } from "@nestjs/common";
import type { Job } from "pg-boss";
import { createDispatcher, type SubscriberRegistry } from "./subscribers";

export type JobHandler = (job: Job) => Promise<unknown>;
export type HandlerRegistry = Partial<Record<QueueName, JobHandler>>;

export interface HandlerDeps {
  context: INestApplicationContext;
  subscribers: SubscriberRegistry;
}

/** Job handlers by queue. Handlers call application services; they hold no business rules. */
export function createHandlers(deps: HandlerDeps): HandlerRegistry {
  const dispatch = createDispatcher(deps.subscribers);
  const sessions = deps.context.get(SessionService);
  const backup = deps.context.get(BackupService);
  const intakes = deps.context.get(IntakesService);
  const notifications = deps.context.get(NotificationsService);
  const offers = deps.context.get(OffersService);
  return {
    "domain-event": (job) => dispatch(job.data as DomainEvent),
    "auth.session-cleanup": () => sessions.deleteEnded(),
    "db.logical-backup": () => backup.run(),
    "admissions.intake-status": () => intakes.syncStatuses({ userId: null, type: "JOB" }),
    "admissions.offer-sweep": () => offers.sweep(),
    "notify.send": (job) =>
      notifications.deliver((job.data as { notificationId: string }).notificationId),
  };
}
