import { randomBytes } from "node:crypto";
import type { DataExport } from "@glim/contracts";
import { Db, schema } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { FilesService } from "@glim/modules/content";
import { SessionService } from "@glim/modules/identity";
import { NotificationsService } from "@glim/modules/notifications";
import {
  CLOCK,
  domainError,
  err,
  ok,
  type Clock,
  type DomainError,
  type DomainResult,
} from "@glim/shared";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";

type Actor = AuditActor & { userId: string };

/** Never part of an export: secrets and security counters, not personal data about the person. */
function withoutSecrets<T extends Record<string, unknown>>(row: T, keys: string[]): Partial<T> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k))) as Partial<T>;
}

const notFound = () => err(domainError("NOT_FOUND", "Not found."));

/**
 * Data subject requests (TRD §19.4, NDPA 2023): anyone can download what GLIM holds about them,
 * and the System Admin can erase a person. Erasure removes and anonymises personal details but
 * keeps the academic records the institution must retain (results, awards, issued transcripts),
 * tied to the pseudonymous student id.
 */
@Injectable()
export class DataRightsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  /** The caller's own data, as JSON (their own application answers included). */
  async exportFor(userId: string): Promise<DataExport> {
    const db = this.db.read;
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (user === undefined) throw new Error("exporting a user that doesn't exist");
    const sections: Record<string, unknown> = {
      account: withoutSecrets(user, ["passwordHash", "failedLoginCount", "lockedUntil", "version"]),
      signInMethods: (
        await db.select().from(schema.identities).where(eq(schema.identities.userId, userId))
      ).map((r) => ({ provider: r.provider, email: r.email, linkedAt: r.createdAt })),
      sessions: (
        await db.select().from(schema.authSessions).where(eq(schema.authSessions.userId, userId))
      ).map((r) => withoutSecrets(r, ["tokenHash", "csrfSecret"])),
      roles: await db
        .select({
          role: schema.roleAssignments.role,
          grantedAt: schema.roleAssignments.createdAt,
          revokedAt: schema.roleAssignments.revokedAt,
        })
        .from(schema.roleAssignments)
        .where(eq(schema.roleAssignments.userId, userId)),
      applications: await db
        .select()
        .from(schema.applications)
        .where(eq(schema.applications.applicantUserId, userId)),
      notifications: await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, userId)),
      notificationPreferences: await db
        .select()
        .from(schema.notificationPreferences)
        .where(eq(schema.notificationPreferences.userId, userId)),
      files: (await db.select().from(schema.files).where(eq(schema.files.ownerUserId, userId))).map(
        (r) => withoutSecrets(r, ["storageKey", "uploadId"]),
      ),
      playbackProgress: await db
        .select()
        .from(schema.playbackProgress)
        .where(eq(schema.playbackProgress.userId, userId)),
    };

    const students = await db
      .select()
      .from(schema.students)
      .where(eq(schema.students.userId, userId));
    const studentIds = students.map((s) => s.id);
    if (studentIds.length > 0) {
      sections.student = students;
      sections.programmeEnrollments = await db
        .select()
        .from(schema.programmeEnrollments)
        .where(inArray(schema.programmeEnrollments.studentId, studentIds));
      sections.courseEnrollments = await db
        .select()
        .from(schema.courseEnrollments)
        .where(inArray(schema.courseEnrollments.studentId, studentIds));
      sections.courseResults = await db
        .select()
        .from(schema.courseResults)
        .where(
          and(
            inArray(schema.courseResults.studentId, studentIds),
            ne(schema.courseResults.status, "DRAFT"),
          ),
        );
      sections.awards = await db
        .select()
        .from(schema.awards)
        .innerJoin(
          schema.programmeEnrollments,
          eq(schema.programmeEnrollments.id, schema.awards.programmeEnrollmentId),
        )
        .where(inArray(schema.programmeEnrollments.studentId, studentIds))
        .then((rows) => rows.map((r) => r.awards));
      // Grades a Lecturer hasn't released yet aren't the student's to see (§14.2).
      sections.grades = await db
        .select()
        .from(schema.grades)
        .where(
          and(
            inArray(schema.grades.studentId, studentIds),
            inArray(schema.grades.status, ["RELEASED", "EXCUSED"]),
          ),
        );
      sections.submissions = await db
        .select()
        .from(schema.assignmentSubmissions)
        .where(inArray(schema.assignmentSubmissions.studentId, studentIds));
      sections.quizAttempts = (
        await db
          .select()
          .from(schema.quizAttempts)
          .where(inArray(schema.quizAttempts.studentId, studentIds))
      ).map((r) => withoutSecrets(r, ["questionSnapshot"]));
      sections.attendance = await db
        .select()
        .from(schema.attendanceRecords)
        .where(inArray(schema.attendanceRecords.studentId, studentIds));
      sections.transcriptRequests = await db
        .select()
        .from(schema.transcriptRequests)
        .where(inArray(schema.transcriptRequests.studentId, studentIds));
      sections.transcripts = await db
        .select()
        .from(schema.transcripts)
        .where(inArray(schema.transcripts.studentId, studentIds));
    }

    const lecturers = await db
      .select()
      .from(schema.lecturers)
      .where(eq(schema.lecturers.userId, userId));
    if (lecturers.length > 0) {
      sections.lecturer = lecturers;
      sections.teaching = await db
        .select()
        .from(schema.lecturerAssignments)
        .where(
          inArray(
            schema.lecturerAssignments.lecturerId,
            lecturers.map((l) => l.id),
          ),
        );
    }
    return {
      exportedAt: this.clock.now().toISOString(),
      userId,
      note: "Everything GLIM Online Bible College holds about you, by area. Grades still in draft, other people's data and security secrets are left out.",
      sections: JSON.parse(JSON.stringify(sections)) as Record<string, unknown>,
    };
  }

  /**
   * Erases a person (System Admin, with a reason): the account is anonymised and deactivated,
   * sign-in methods, sessions, tokens, notifications and preferences are deleted, applications
   * (with their sensitive answers) and passport photos are deleted, and the student and Lecturer
   * profiles keep only what academic records need, under a pseudonym. Results, awards, issued
   * transcripts and coursework are retained as the law requires. Someone holding a staff role, or
   * the caller, can't be erased.
   */
  async erase(
    userId: string,
    reason: string,
    actor: Actor,
  ): Promise<DomainResult<{ pseudonym: string }>> {
    if (userId === actor.userId) return err(domainError("CONFLICT", "You can't erase yourself."));
    const photoKeys: string[] = [];
    const result = await this.db.withTxResult<string, DomainError>(async ({ db }) => {
      const u = schema.users;
      const [user] = await db.select().from(u).where(eq(u.id, userId)).for("update");
      if (user === undefined) return notFound();
      if (user.email.endsWith("@erased.invalid")) return ok(user.displayName);
      const roles = await db
        .select({ id: schema.roleAssignments.id })
        .from(schema.roleAssignments)
        .where(
          and(eq(schema.roleAssignments.userId, userId), isNull(schema.roleAssignments.revokedAt)),
        );
      if (roles.length > 0)
        return err(
          domainError("CONFLICT", "Revoke this person's staff roles before erasing them."),
        );
      const tag = randomBytes(5).toString("hex");
      const pseudonym = `Erased ${tag}`;
      const now = this.clock.now();

      // Signed out everywhere at once (the session cache forgets them too).
      await this.sessions.revokeAllForUser(db, userId);
      await db.delete(schema.identities).where(eq(schema.identities.userId, userId));
      await db.delete(schema.authSessions).where(eq(schema.authSessions.userId, userId));
      await db.delete(schema.authTokens).where(eq(schema.authTokens.userId, userId));
      await db.delete(schema.notifications).where(eq(schema.notifications.userId, userId));
      await db
        .delete(schema.notificationPreferences)
        .where(eq(schema.notificationPreferences.userId, userId));
      await db.delete(schema.playbackProgress).where(eq(schema.playbackProgress.userId, userId));

      // Applications hold sensitive answers (INV-15): gone entirely, with their photos.
      const apps = await db
        .select({ id: schema.applications.id, photoFileId: schema.applications.photoFileId })
        .from(schema.applications)
        .where(eq(schema.applications.applicantUserId, userId));
      if (apps.length > 0)
        // The enrollment keeps its Matric Number; only the link to the deleted application goes.
        await db
          .update(schema.programmeEnrollments)
          .set({ applicationId: null, updatedAt: now })
          .where(
            inArray(
              schema.programmeEnrollments.applicationId,
              apps.map((a) => a.id),
            ),
          );
      for (const app of apps) {
        await this.notifications.forgetApplication(db, app.id);
        await db.delete(schema.applications).where(eq(schema.applications.id, app.id));
      }

      const students = await db
        .select()
        .from(schema.students)
        .where(eq(schema.students.userId, userId));
      for (const s of students) {
        await db
          .update(schema.students)
          .set({
            title: null,
            givenName: "Erased",
            middleName: null,
            familyName: tag,
            gender: null,
            dateOfBirth: null,
            nationality: null,
            phoneWhatsapp: null,
            altPhoneWhatsapp: null,
            country: null,
            stateProvince: null,
            city: null,
            postcode: null,
            address: null,
            churchName: null,
            churchAddress: null,
            pastorName: null,
            pastorPhone: null,
            photoFileId: null,
            updatedAt: now,
          })
          .where(eq(schema.students.id, s.id));
      }
      await db
        .update(schema.lecturers)
        .set({ title: null, givenName: "Erased", familyName: tag, bio: null, updatedAt: now })
        .where(eq(schema.lecturers.userId, userId));

      // Passport photos (application or student record) are personal data, not academic records.
      const photos = [
        ...apps.map((a) => a.photoFileId),
        ...students.map((s) => s.photoFileId),
      ].filter((id): id is string => id !== null);
      for (const id of new Set(photos)) {
        const key = await this.files.deleteRecord(db, id);
        if (key !== null) photoKeys.push(key);
      }

      await db
        .update(u)
        .set({
          email: `${tag}@erased.invalid`,
          displayName: pseudonym,
          status: "DEACTIVATED",
          passwordHash: null,
          timezone: null,
          referralCode: null,
          lastLoginAt: null,
          updatedAt: now,
        })
        .where(eq(u.id, userId));
      await this.audit.record(db, actor, {
        action: "identity.user.erased",
        resourceType: "user",
        resourceId: userId,
        metadata: { pseudonym, reason, applicationsDeleted: apps.length },
      });
      return ok(pseudonym);
    });
    if (!result.ok) return result;
    for (const key of photoKeys)
      await this.files.removeObject(key).catch((error: unknown) => {
        this.logger.warn({ err: error }, "erased photo object could not be removed");
      });
    return ok({ pseudonym: result.value });
  }
}
