import { Db, schema } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { AuthorizationService, RoleService } from "@glim/modules/authorization";
import { FilesService } from "@glim/modules/content";
import { StudentsService } from "@glim/modules/enrollment";
import { PolicyService, UserAdminService } from "@glim/modules/identity";
import { NotificationsService } from "@glim/modules/notifications";
import { CLOCK, type Clock } from "@glim/shared";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, lte, or } from "drizzle-orm";

const JOB: AuditActor = { userId: null, type: "JOB" };
const ENDED = ["REJECTED", "LAPSED", "WITHDRAWN"];

/**
 * The daily `admissions.purge` (TRD §10.5, C-29, D-06): hard-deletes rejected, lapsed and
 * withdrawn applications once `purge_after` passes, and drafts not edited for the purge period,
 * with their events, notifications and passport photo. The audit log keeps only the reference
 * number and final status. Applicants left with nothing else are deactivated.
 */
@Injectable()
export class PurgeService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PolicyService) private readonly policies: PolicyService,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(StudentsService) private readonly students: StudentsService,
    @Inject(RoleService) private readonly roles: RoleService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(UserAdminService) private readonly userAdmin: UserAdminService,
  ) {}

  async run(): Promise<{ purged: number; deactivated: number }> {
    const now = this.clock.now();
    const { config } = await this.policies.current("ADMISSIONS");
    const staleBefore = new Date(now);
    staleBefore.setUTCMonth(staleBefore.getUTCMonth() - config.purgeAfterMonths);
    const a = schema.applications;
    const due = or(
      and(inArray(a.status, ENDED), lte(a.purgeAfter, now)),
      and(eq(a.status, "DRAFT"), lte(a.updatedAt, staleBefore)),
    );
    const candidates = await this.db.read.select({ id: a.id }).from(a).where(due);

    const applicants = new Set<string>();
    let purged = 0;
    for (const { id } of candidates) {
      const removed = await this.db.withTx(async (tx) => {
        const [current] = await tx.db
          .select()
          .from(a)
          .where(and(eq(a.id, id), due))
          .for("update");
        if (current === undefined) return null;
        await this.notifications.forgetApplication(tx.db, id);
        await tx.db.delete(a).where(eq(a.id, id)); // application_events cascade
        const photoKey =
          current.photoFileId !== null &&
          !(await this.students.usesPhoto(current.photoFileId, tx.db))
            ? await this.files.deleteRecord(tx.db, current.photoFileId)
            : null;
        await this.audit.record(tx.db, JOB, {
          action: "admissions.application.purged",
          resourceType: "application",
          resourceId: id,
          metadata: { referenceNo: current.referenceNo, finalStatus: current.status },
        });
        return { applicantUserId: current.applicantUserId, photoKey };
      });
      if (removed === null) continue;
      purged++;
      applicants.add(removed.applicantUserId);
      if (removed.photoKey !== null) {
        await this.files.removeObject(removed.photoKey).catch((error: unknown) => {
          this.logger.warn({ err: error }, "purged photo object could not be removed");
        });
      }
    }

    let deactivated = 0;
    for (const userId of applicants) {
      if (await this.hasNothingLeft(userId)) {
        const result = await this.userAdmin.deactivate(
          userId,
          "Applicant with no remaining application (purge)",
          JOB,
        );
        if (result.ok) deactivated++;
      }
    }
    return { purged, deactivated };
  }

  /** A role-less applicant with no other application, student record or Lecturer profile. */
  private async hasNothingLeft(userId: string): Promise<boolean> {
    const a = schema.applications;
    const [other] = await this.db.read
      .select({ id: a.id })
      .from(a)
      .where(eq(a.applicantUserId, userId))
      .limit(1);
    if (other !== undefined) return false;
    if ((await this.roles.activeRoles(userId)).length > 0) return false;
    if (await this.students.hasStudentRecord(userId)) return false;
    return !(await this.authorization.derivedRoles(userId)).isLecturer;
  }
}
