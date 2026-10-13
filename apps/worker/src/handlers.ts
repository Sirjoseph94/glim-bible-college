import { QUEUES, type DomainEvent, type QueueName } from "@glim/contracts";
import { IntakesService, OffersService, PurgeService } from "@glim/modules/admissions";
import { SessionService, UserAdminService } from "@glim/modules/identity";
import { AttendanceService, ParticipantsService } from "@glim/modules/attendance";
import { LIVE_PROVIDER, type LiveProvider } from "@glim/integrations/live-provider/port";
import {
  MeetEventsService,
  MeetingLifecycleService,
  ProvisioningService,
  SeriesService,
  SubscriptionsService,
} from "@glim/modules/class-meeting";
import { ImportsService } from "@glim/modules/imports";
import { ProgressionService, RegistrationService } from "@glim/modules/enrollment";
import { NotificationsService } from "@glim/modules/notifications";
import { BackupService, InboxService, OpsService } from "@glim/modules/ops";
import { AvailabilityService, RecordingsService, VideoAdminService } from "@glim/modules/video";
import { QuizAttemptsService } from "@glim/modules/assessment";
import { SemesterResultsService } from "@glim/modules/results";
import { TranscriptsService } from "@glim/modules/transcripts";
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
  const inbox = deps.context.get(InboxService);
  const ops = deps.context.get(OpsService);
  const intakes = deps.context.get(IntakesService);
  const notifications = deps.context.get(NotificationsService);
  const offers = deps.context.get(OffersService);
  const purge = deps.context.get(PurgeService);
  const registration = deps.context.get(RegistrationService);
  const progression = deps.context.get(ProgressionService);
  const imports = deps.context.get(ImportsService);
  const series = deps.context.get(SeriesService);
  const lifecycle = deps.context.get(MeetingLifecycleService);
  const provisioning = deps.context.get(ProvisioningService);
  const meetEvents = deps.context.get(MeetEventsService);
  const subscriptions = deps.context.get(SubscriptionsService);
  const participants = deps.context.get(ParticipantsService);
  const recordings = deps.context.get(RecordingsService);
  // Google Meet (integration slice): without a provider these queues get no handler, so their
  // cron schedules are removed and nothing polls Google.
  const google: HandlerRegistry =
    deps.context.get<LiveProvider | null>(LIVE_PROVIDER) === null
      ? {}
      : {
          "class-meeting.provision": (job) =>
            provisioning.provision((job.data as { meetingId: string }).meetingId, {
              final: job.retryCount >= QUEUES["class-meeting.provision"].retryLimit,
            }),
          "class-meeting.sync-access": (job) =>
            provisioning.syncAccess((job.data as { meetingId: string }).meetingId),
          "class-meeting.end": (job) =>
            provisioning.endConference((job.data as { meetingId: string }).meetingId),
          "meeting.reconcile": () => meetEvents.reconcile(),
          "recording.discover": (job) =>
            recordings.discover(
              job.data as { meetingId: string; conferenceId: string; recordingId: string },
            ),
          "recording.ingest": (job) =>
            recordings.ingest((job.data as { recordingId: string }).recordingId, {
              final: job.retryCount >= QUEUES["recording.ingest"].retryLimit,
            }),
          "recording.reconcile": () => recordings.reconcile(),
          "drive.cleanup": (job) =>
            recordings.cleanup((job.data as { recordingId: string }).recordingId),
          "conference.sync": (job) =>
            participants.syncConference(
              (job.data as { conferenceRecordId: string }).conferenceRecordId,
            ),
          // The 15-minute sweep, or one subscription a lifecycle event named.
          "subscription.renew": (job) =>
            subscriptions.run((job.data as { remoteName?: string } | null)?.remoteName),
        };
  const attendance = deps.context.get(AttendanceService);
  const userAdmin = deps.context.get(UserAdminService);
  const videoAvailability = deps.context.get(AvailabilityService);
  const videoAdmin = deps.context.get(VideoAdminService);
  const quizAttempts = deps.context.get(QuizAttemptsService);
  const semesterResults = deps.context.get(SemesterResultsService);
  const transcripts = deps.context.get(TranscriptsService);
  return {
    "domain-event": (job) => dispatch(job.data as DomainEvent),
    "auth.session-cleanup": () => sessions.deleteEnded(),
    "db.logical-backup": () => backup.run(),
    "admissions.intake-status": () => intakes.syncStatuses({ userId: null, type: "JOB" }),
    "admissions.offer-sweep": () => offers.sweep(),
    "admissions.purge": () => purge.run(),
    "class-meeting.series-extend": () => series.extend(),
    "meeting.tick": () => lifecycle.tick(),
    ...google,
    // The daily sweep, or one video the System Admin asked to recheck from the ops page.
    "video.availability-check": async (job) => {
      const one = job.data as { videoId?: string; actorUserId?: string } | null;
      if (one?.videoId === undefined) return videoAvailability.checkAll();
      return videoAvailability.recheck(one.videoId, {
        type: "USER",
        userId: one.actorUserId ?? "",
      });
    },
    "video.purge-deleted": () => videoAdmin.purgeDeleted(),
    // The channel connection (integration slice); both skip when the app can't act as it.
    "video.youtube-processing-sync": (job) => {
      const { videoId, poll } = job.data as { videoId: string; poll?: number };
      return recordings.processingSync(videoId, poll ?? 0);
    },
    "video.youtube-metadata": (job) =>
      recordings.syncMetadata((job.data as { videoId: string }).videoId),
    "quiz.expire": (job) => quizAttempts.expire((job.data as { attemptId: string }).attemptId),
    "transcript.generate": (job) =>
      transcripts.generate((job.data as { transcriptId: string }).transcriptId),
    "transcript.send": (job) => {
      const { transcriptId, to } = job.data as { transcriptId: string; to: string };
      return transcripts.sendNow(transcriptId, to);
    },
    "results.compute-semester": async (job) => {
      await semesterResults.compute((job.data as { semesterId: string }).semesterId);
    },
    "attendance.recompute": (job) =>
      attendance.recompute((job.data as { meetingId: string }).meetingId),
    "class-meeting.finalize": (job) =>
      attendance.finalize((job.data as { meetingId: string }).meetingId),
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
    // The 06:00 Lagos cron (no user) fans out; each person's digest then runs on its own.
    "notify.digest": (job) =>
      notifications.digest((job.data as { userId?: string } | null)?.userId),
    "ops.queue-health": () => ops.checkQueues(),
    "ops.youtube-check": () => ops.runYoutubeCheck(),
    "provider-event.process": (job) =>
      inbox.process((job.data as { providerEventId: string }).providerEventId),
  };
}
