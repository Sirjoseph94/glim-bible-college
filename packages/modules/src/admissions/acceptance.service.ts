import type { Application, StudyMode } from "@glim/contracts";
import { Db, schema } from "@glim/db";
import { CohortsService, CurriculaService } from "@glim/modules/academic";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { RoleService } from "@glim/modules/authorization";
import {
  RegistrationService,
  StudentsService,
  type StudentProfile,
} from "@glim/modules/enrollment";
import { UserService } from "@glim/modules/identity";
import { NotificationsService } from "@glim/modules/notifications";
import { CLOCK, domainError, err, type Clock, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { selectApplications } from "./application-query";
import { ApplicationsService } from "./applications.service";
import { recordTransition } from "./transitions";

type ApplicationRow = typeof schema.applications.$inferSelect;

const TITLE_LABEL: Record<string, string> = {
  MR: "Mr",
  MRS: "Mrs",
  PASTOR: "Pastor",
  REV: "Rev",
  DR: "Dr",
};

/**
 * What the student record takes from the application (§10.4 step 2): name, title, gender, date
 * of birth, nationality, phones, address, church and photo. Never spiritual background, marital
 * status or occupation (INV-15).
 */
function studentProfile(r: ApplicationRow): StudentProfile {
  return {
    title:
      r.title === "OTHER" ? r.titleOther : r.title === null ? null : (TITLE_LABEL[r.title] ?? null),
    givenName: r.firstName ?? "",
    middleName: r.middleName,
    familyName: r.lastName ?? "",
    gender: r.gender,
    dateOfBirth: r.dateOfBirth,
    nationality: r.nationality,
    phoneWhatsapp: r.phoneWhatsapp,
    altPhoneWhatsapp: r.altPhoneWhatsapp,
    country: r.country,
    stateProvince: r.stateProvince,
    city: r.city,
    postcode: r.postcode,
    address: r.address,
    churchName: r.churchName,
    churchAddress: r.churchAddress,
    pastorName: r.pastorName,
    pastorPhone: r.pastorPhone,
    photoFileId: r.photoFileId,
  };
}

/**
 * Accepting an offer (TRD §10.4, AC-16), all in one transaction: the applicant becomes a student
 * with a Matric Number and an ACTIVE programme enrollment in their cohort, gets a referral code
 * and a welcome email, and the Academic Admins are told.
 */
@Injectable()
export class AcceptanceService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ApplicationsService) private readonly applications: ApplicationsService,
    @Inject(CurriculaService) private readonly curricula: CurriculaService,
    @Inject(CohortsService) private readonly cohorts: CohortsService,
    @Inject(StudentsService) private readonly students: StudentsService,
    @Inject(RegistrationService) private readonly registration: RegistrationService,
    @Inject(UserService) private readonly users: UserService,
    @Inject(RoleService) private readonly roles: RoleService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  accept(id: string, actor: AuditActor & { userId: string }): Promise<DomainResult<Application>> {
    return this.db.withTxResult(async (tx) => {
      const { db } = tx;
      const a = schema.applications;
      const [current] = await db.select().from(a).where(eq(a.id, id)).for("update");
      if (current === undefined) return err(domainError("NOT_FOUND", "Not found."));
      if (current.status !== "ADMITTED")
        return err(
          domainError(
            "APPLICATION_STATE_INVALID",
            current.status === "ACCEPTED"
              ? "You've already accepted this offer."
              : "There's no offer to accept.",
          ),
        );
      const now = this.clock.now();
      if (current.offerExpiresAt === null || now > current.offerExpiresAt)
        return err(
          domainError(
            "OFFER_EXPIRED",
            "This offer has expired. Contact Admissions if you'd still like to study with us.",
          ),
        );

      const [found] = await selectApplications(eq(a.id, id), db);
      const [intake] = await db
        .select({
          id: schema.intakes.id,
          code: schema.intakes.code,
          sessionId: schema.intakes.academicSessionId,
        })
        .from(schema.intakes)
        .where(eq(schema.intakes.id, current.intakeId));
      if (found === undefined || intake === undefined)
        return err(domainError("NOT_FOUND", "Not found."));
      const curriculumId = await this.curricula.activeFor(current.programmeId, db);
      if (curriculumId === null)
        return err(
          domainError(
            "CONFLICT",
            "This programme can't enroll students yet. Please contact Admissions, who can help.",
          ),
        );
      const cohortId = await this.cohorts.getOrCreate(db, {
        programme: found.programme,
        intake: { id: intake.id, code: intake.code },
      });
      const admitted = await this.students.admit(db, {
        userId: current.applicantUserId,
        profile: studentProfile(current),
        programme: found.programme,
        intake: { id: intake.id, year: Number(intake.code) },
        cohortId,
        curriculumId,
        entrySessionId: intake.sessionId,
        startedOn: found.intake.startsOn,
        applicationId: id,
        studyMode: current.studyMode as StudyMode,
      });
      if (!admitted.ok) return admitted;
      const { matricNumber, enrollmentId } = admitted.value;
      // §10.4 step 5: if the entry session's first semester is already open, register now.
      const [firstSemester] = await db
        .select({ id: schema.semesters.id, status: schema.semesters.status })
        .from(schema.semesters)
        .where(
          and(
            eq(schema.semesters.academicSessionId, intake.sessionId),
            eq(schema.semesters.sequence, 1),
          ),
        );
      if (firstSemester !== undefined && ["REGISTRATION", "ACTIVE"].includes(firstSemester.status))
        await this.registration.registerEnrollment(
          tx,
          firstSemester.id,
          enrollmentId,
          actor.userId,
        );
      const referralCode = await this.users.ensureReferralCode(db, current.applicantUserId);

      await db
        .update(a)
        .set({
          status: "ACCEPTED",
          acceptedAt: now,
          updatedAt: now,
          version: sql`${a.version} + 1`,
        })
        .where(eq(a.id, id));
      await recordTransition(tx, this.audit, {
        applicationId: id,
        from: current.status,
        to: "ACCEPTED",
        actor,
        now,
        metadata: { matricNumber },
      });

      const name = [current.firstName, current.lastName].filter(Boolean).join(" ");
      await this.notifications.notify(tx, {
        userId: current.applicantUserId,
        kind: "admissions.application.accepted",
        title: `Welcome to GLIM: your Matric Number is ${matricNumber}`,
        data: {
          applicationId: id,
          name,
          matricNumber,
          referralCode,
          programmeName: found.programme.name,
          academicSessionName: found.intake.academicSessionName,
          sessionStartsOn: found.intake.startsOn,
          ...(current.email === null ? {} : { emailTo: current.email }),
        },
        email: true,
        dedupeKey: `application-accepted:${id}`,
      });
      for (const adminId of await this.roles.holders("ACADEMIC_ADMIN", db)) {
        await this.notifications.notify(tx, {
          userId: adminId,
          kind: "enrollment.student.admitted",
          title: `${name} accepted a place on the ${found.programme.name}`,
          body: `Matric Number ${matricNumber}, studying ${current.studyMode === "ON_CAMPUS" ? "on campus" : "online"}.`,
          data: { applicationId: id, matricNumber },
          email: false,
          dedupeKey: `student-admitted:${id}`,
        });
      }
      return this.applications.view(db, id);
    });
  }
}
