import type { StudyMode } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

/**
 * What a student record holds, copied from the application on acceptance (§10.4). It has no place
 * for spiritual background, marital status or occupation, which are never copied (INV-15).
 */
export interface StudentProfile {
  title: string | null;
  givenName: string;
  middleName: string | null;
  familyName: string;
  gender: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  phoneWhatsapp: string | null;
  altPhoneWhatsapp: string | null;
  country: string | null;
  stateProvince: string | null;
  city: string | null;
  postcode: string | null;
  address: string | null;
  churchName: string | null;
  churchAddress: string | null;
  pastorName: string | null;
  pastorPhone: string | null;
  photoFileId: string | null;
}

export interface Admission {
  userId: string;
  profile: StudentProfile;
  programme: { id: string; code: string };
  /** The intake year, which numbers the Matric (D-01). */
  intake: { id: string; year: number };
  cohortId: string;
  curriculumId: string;
  entrySessionId: string;
  startedOn: string;
  applicationId: string;
  studyMode: StudyMode;
}

/** Students and their programme enrollments (owner: enrollment, TRD §6.3, §10.4). */
@Injectable()
export class StudentsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Makes the user a student of the programme inside the caller's transaction: creates the
   * student (or refreshes an existing one, e.g. a Certificate graduate admitted to the Diploma),
   * allocates the next Matric Number and creates the ACTIVE programme enrollment at Level 1.
   */
  async admit(
    db: Database,
    input: Admission,
  ): Promise<DomainResult<{ studentId: string; matricNumber: string; enrollmentId: string }>> {
    const s = schema.students;
    const [existing] = await db.select().from(s).where(eq(s.userId, input.userId)).for("update");
    let studentId: string;
    if (existing === undefined) {
      const [created] = await db
        .insert(s)
        .values({ userId: input.userId, ...input.profile })
        .returning({ id: s.id });
      if (created === undefined) throw new Error("student insert returned nothing");
      studentId = created.id;
    } else {
      studentId = existing.id;
      await db
        .update(s)
        .set({
          ...input.profile,
          status: "ACTIVE",
          updatedAt: this.clock.now(),
          version: sql`${s.version} + 1`,
        })
        .where(eq(s.id, studentId));
    }

    const pe = schema.programmeEnrollments;
    const [active] = await db
      .select({ id: pe.id })
      .from(pe)
      .where(
        and(
          eq(pe.studentId, studentId),
          eq(pe.programmeId, input.programme.id),
          eq(pe.status, "ACTIVE"),
        ),
      );
    if (active !== undefined)
      return err(domainError("ALREADY_ENROLLED", "You're already enrolled on this programme."));

    const matricNumber = await this.nextMatricNumber(db, input.programme, input.intake.year);
    const [enrollment] = await db
      .insert(pe)
      .values({
        studentId,
        programmeId: input.programme.id,
        curriculumId: input.curriculumId,
        intakeId: input.intake.id,
        cohortId: input.cohortId,
        entrySessionId: input.entrySessionId,
        applicationId: input.applicationId,
        matricNumber,
        studyMode: input.studyMode,
        startedOn: input.startedOn,
      })
      .returning({ id: pe.id });
    if (enrollment === undefined) throw new Error("enrollment insert returned nothing");
    return ok({ studentId, matricNumber, enrollmentId: enrollment.id });
  }

  /** The Matric Number given for an application, once accepted. */
  async matricForApplication(
    applicationId: string,
    db: Database = this.db.read,
  ): Promise<string | null> {
    const pe = schema.programmeEnrollments;
    const [row] = await db
      .select({ matric: pe.matricNumber })
      .from(pe)
      .where(eq(pe.applicationId, applicationId));
    return row?.matric ?? null;
  }

  /** Whether the user is a student now (an ACTIVE student row, §7.1). */
  async isActiveStudent(userId: string, db: Database = this.db.read): Promise<boolean> {
    const s = schema.students;
    const [row] = await db
      .select({ id: s.id })
      .from(s)
      .where(and(eq(s.userId, userId), eq(s.status, "ACTIVE")));
    return row !== undefined;
  }

  /** Locks the programme's sequence for the year: GLIM/{programme}/{YYYY}/{NNNN}, gap-free (D-01). */
  private async nextMatricNumber(
    db: Database,
    programme: { id: string; code: string },
    year: number,
  ): Promise<string> {
    const q = schema.matricSequences;
    await db.insert(q).values({ programmeId: programme.id, year }).onConflictDoNothing();
    const [sequence] = await db
      .select()
      .from(q)
      .where(and(eq(q.programmeId, programme.id), eq(q.year, year)))
      .for("update");
    if (sequence === undefined) throw new Error("matric sequence row missing");
    await db
      .update(q)
      .set({ nextValue: sequence.nextValue + 1 })
      .where(and(eq(q.programmeId, programme.id), eq(q.year, year)));
    return `GLIM/${programme.code.toUpperCase()}/${String(year)}/${String(sequence.nextValue).padStart(4, "0")}`;
  }
}
