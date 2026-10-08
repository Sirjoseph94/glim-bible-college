import { meetings, type BodyOf, type ParamsOf, type QueryOf } from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import {
  ClassMeetingsService,
  MeetingLifecycleService,
  SeriesService,
} from "@glim/modules/class-meeting";
import type { ActiveSession } from "@glim/modules/identity";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params, Query } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** Class Meetings (TRD §11, v1 spec): schedule, series, read, change, cancel, and my schedule. */
@Controller()
export class ClassMeetingsController {
  constructor(
    @Inject(ClassMeetingsService) private readonly meetings: ClassMeetingsService,
    @Inject(SeriesService) private readonly series: SeriesService,
    @Inject(MeetingLifecycleService) private readonly lifecycle: MeetingLifecycleService,
  ) {}

  @Endpoint(meetings.createClassMeeting)
  async create(
    @Params(meetings.createClassMeeting) params: ParamsOf<typeof meetings.createClassMeeting>,
    @Body(meetings.createClassMeeting) body: BodyOf<typeof meetings.createClassMeeting>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof meetings.createClassMeeting>> {
    return unwrap(
      await this.meetings.create(params.id, body, { ...actor, userId: session.userId }),
    );
  }

  @Endpoint(meetings.listClassMeetings)
  async list(
    @Params(meetings.listClassMeetings) params: ParamsOf<typeof meetings.listClassMeetings>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof meetings.listClassMeetings>> {
    return { items: await this.meetings.listForOffering(params.id, session.userId) };
  }

  @Endpoint(meetings.getClassMeeting)
  async get(
    @Params(meetings.getClassMeeting) params: ParamsOf<typeof meetings.getClassMeeting>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof meetings.getClassMeeting>> {
    const meeting = await this.meetings.get(params.id, session.userId);
    if (meeting === null) throw new AppError("NOT_FOUND", "Not found.");
    return meeting;
  }

  @Endpoint(meetings.updateClassMeeting)
  async update(
    @Params(meetings.updateClassMeeting) params: ParamsOf<typeof meetings.updateClassMeeting>,
    @Body(meetings.updateClassMeeting) body: BodyOf<typeof meetings.updateClassMeeting>,
    @IfMatch() version: number,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof meetings.updateClassMeeting>> {
    return unwrap(
      await this.meetings.update(params.id, version, body, { ...actor, userId: session.userId }),
    );
  }

  @Endpoint(meetings.cancelClassMeeting)
  async cancel(
    @Params(meetings.cancelClassMeeting) params: ParamsOf<typeof meetings.cancelClassMeeting>,
    @Body(meetings.cancelClassMeeting) body: BodyOf<typeof meetings.cancelClassMeeting>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof meetings.cancelClassMeeting>> {
    return unwrap(
      await this.meetings.cancel(params.id, body, { ...actor, userId: session.userId }),
    );
  }

  @Endpoint(meetings.createClassMeetingSeries)
  async createSeries(
    @Params(meetings.createClassMeetingSeries)
    params: ParamsOf<typeof meetings.createClassMeetingSeries>,
    @Body(meetings.createClassMeetingSeries)
    body: BodyOf<typeof meetings.createClassMeetingSeries>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof meetings.createClassMeetingSeries>> {
    return unwrap(await this.series.create(params.id, body, { ...actor, userId: session.userId }));
  }

  @Endpoint(meetings.joinClassMeeting)
  async join(
    @Params(meetings.joinClassMeeting) params: ParamsOf<typeof meetings.joinClassMeeting>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof meetings.joinClassMeeting>> {
    return unwrap(await this.lifecycle.join(params.id, session.userId));
  }

  @Endpoint(meetings.startClassMeeting)
  async start(
    @Params(meetings.startClassMeeting) params: ParamsOf<typeof meetings.startClassMeeting>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof meetings.startClassMeeting>> {
    return unwrap(await this.lifecycle.start(params.id, { ...actor, userId: session.userId }));
  }

  @Endpoint(meetings.endClassMeeting)
  async end(
    @Params(meetings.endClassMeeting) params: ParamsOf<typeof meetings.endClassMeeting>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof meetings.endClassMeeting>> {
    return unwrap(await this.lifecycle.end(params.id, { ...actor, userId: session.userId }));
  }

  @Endpoint(meetings.getMySchedule)
  async schedule(
    @Query(meetings.getMySchedule) query: QueryOf<typeof meetings.getMySchedule>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof meetings.getMySchedule>> {
    return { items: await this.meetings.schedule(session.userId, query) };
  }
}
