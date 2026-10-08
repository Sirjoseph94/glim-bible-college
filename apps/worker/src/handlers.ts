import type { DomainEvent, QueueName } from "@glim/contracts";
import { IntakesService, OffersService, PurgeService } from "@glim/modules/admissions";
import { SessionService, UserAdminService } from "@glim/modules/identity";
import { MeetingLifecycleService, SeriesService } from "@glim/modules/class-meeting";
import { ImportsService } from "@glim/modules/imports";
import { ProgressionService, RegistrationService } from "@glim/modules/enrollment";
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
  const purge = deps.context.get(PurgeService);
  const registration = deps.context.get(RegistrationService);
  const progression = deps.context.get(ProgressionService);
  const imports = deps.context.get(ImportsService);
  const series = deps.context.get(SeriesService);
  const lifecycle = deps.context.get(MeetingLifecycleService);
  const userAdmin = deps.context.get(UserAdminService);
  return {
    "domain-event": (job) => dispatch(job.data as DomainEvent),
    "auth.session-cleanup": () => sessions.deleteEnded(),
    "db.logical-backup": () => backup.run(),
    "admissions.intake-status": () => intakes.syncStatuses({ userId: null, type: "JOB" }),
    "admissions.offer-sweep": () => offers.sweep(),
    "admissions.purge": () => purge.run(),
    "class-meeting.series-extend": () => series.extend(),
    "meeting.tick": () => lifecycle.tick(),
    "import.run": (job) => imports.run((job.data as { importJobId: string }).importJobId),
    // An invite for someone who has since accepted one is simply skipped.
    "identity.invite": (job) =>
      userAdmin.resendInvite((job.data as { userId: string }).userId, {
        userId: null,
        type: "JOB",
      }),
    "academic.progression": (job) => progression.run((job.data as { sessionId: string }).sessionId),
    "semester.open-registration": (job) =>
      registration.openRegistration((job.data as { semesterId: string }).semesterId),
    "notify.send": (job) =>
      notifications.deliver((job.data as { notificationId: string }).notificationId),
  };
}
