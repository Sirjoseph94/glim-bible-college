import { notifications, type BodyOf, type ParamsOf, type QueryOf } from "@glim/contracts";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySendgridSignature,
} from "@glim/integrations/mail/sendgrid-webhook";
import type { ActiveSession } from "@glim/modules/identity";
import { NotificationsService } from "@glim/modules/notifications";
import { InboxService } from "@glim/modules/ops";
import { AppError, CLOCK, type Clock } from "@glim/shared";
import { CONFIG, type Config } from "@glim/shared/config";
import { Controller, Inject, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, Params, Query } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** The notification centre, preferences, and SendGrid's event webhook (§15.1). */
@Controller()
export class NotificationsController {
  constructor(
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(InboxService) private readonly inbox: InboxService,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Endpoint(notifications.getMyNotifications)
  async list(
    @Query(notifications.getMyNotifications)
    query: QueryOf<typeof notifications.getMyNotifications>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof notifications.getMyNotifications>> {
    return this.notifications.list(session.userId, query.before, query.limit);
  }

  @Endpoint(notifications.readNotification)
  async read(
    @Params(notifications.readNotification) params: ParamsOf<typeof notifications.readNotification>,
    @CurrentSession() session: ActiveSession,
  ): Promise<void> {
    await this.notifications.markRead(session.userId, params.id);
  }

  @Endpoint(notifications.readAllNotifications)
  async readAll(
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof notifications.readAllNotifications>> {
    return { count: await this.notifications.markAllRead(session.userId) };
  }

  @Endpoint(notifications.getNotificationPreferences)
  async preferences(
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof notifications.getNotificationPreferences>> {
    return { items: await this.notifications.preferences(session.userId) };
  }

  @Endpoint(notifications.setNotificationPreference)
  async setPreference(
    @Params(notifications.setNotificationPreference)
    params: ParamsOf<typeof notifications.setNotificationPreference>,
    @Body(notifications.setNotificationPreference)
    body: BodyOf<typeof notifications.setNotificationPreference>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof notifications.setNotificationPreference>> {
    const saved = await this.notifications.setPreference(session.userId, params.kind, body);
    if (saved === null) throw new AppError("NOT_FOUND", "No such notification kind.");
    return saved;
  }

  /** Verified before anything is stored; a bad or missing signature is 401 (nothing leaks). */
  @Endpoint(notifications.sendgridEvents)
  async sendgrid(
    @Body(notifications.sendgridEvents) body: BodyOf<typeof notifications.sendgridEvents>,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    const publicKey = this.config.mail.sendgridWebhookPublicKey;
    const signature = req.headers[SIGNATURE_HEADER];
    const timestamp = req.headers[TIMESTAMP_HEADER];
    const valid =
      publicKey !== undefined &&
      req.rawBody !== null &&
      verifySendgridSignature({
        publicKey,
        rawBody: req.rawBody,
        signature: typeof signature === "string" ? signature : undefined,
        timestamp: typeof timestamp === "string" ? timestamp : undefined,
        now: this.clock.now(),
      });
    if (!valid) throw new AppError("UNAUTHENTICATED", "The webhook signature didn't verify.");
    await this.inbox.receiveSendgrid(body);
  }
}
