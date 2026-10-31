import type { ImportKind } from "@glim/contracts";
import { schema, type Database } from "@glim/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { recordImportedResult } from "@glim/modules/results";
import { parseDecimal } from "@glim/shared";
import { z } from "zod";

/** What applying one row did. */
export type RowOutcome = "created" | "updated" | "unchanged";

/** A row the import can't apply; the message goes into the error CSV. */
export class RowError extends Error {}

export interface RowContext {
  db: Database;
  now: Date;
  /** Users the row created (they get invites and referral codes after the batch). */
  createdUsers: string[];
}

const text = (max = 200) => z.string().trim().min(1).max(max);
const optional = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .optional()
    .transform((v) => v ?? null);

const studentRow = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  given_name: text(),
  middle_name: optional(),
  family_name: text(),
  title: optional(60),
  gender: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.enum(["MALE", "FEMALE"]).nullable())
    .optional()
    .transform((v) => v ?? null),
  date_of_birth: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.iso.date().nullable())
    .optional()
    .transform((v) => v ?? null),
  phone_whatsapp: optional(30),
  matric_number: z.string().trim().toUpperCase().min(1).max(40),
  programme_code: z.string().trim().toUpperCase().min(1).max(20),
  study_mode: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => v.replace(/[ -]/g, "_"))
    .pipe(z.enum(["ON_CAMPUS", "ONLINE"])),
  cohort_code: z.string().trim().toUpperCase().min(1).max(40),
});

const lecturerRow = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  title: optional(60),
  given_name: text(),
  family_name: text(),
  kind: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => (v === "" ? "INTERNAL" : v))
    .pipe(z.enum(["INTERNAL", "GUEST"])),
  staff_code: optional(40),
});

const courseEnrollmentRow = z.object({
  matric_number: z.string().trim().toUpperCase().min(1).max(40),
  course_code: z.string().trim().toUpperCase().min(1).max(20),
  /** The cohort whose offering of the course it is; empty is the student's own cohort. */
  cohort_code: optional(40).transform((v) => v?.toUpperCase() ?? null),
  status: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => (v === "" ? "ENROLLED" : v))
    .pipe(z.enum(["ENROLLED", "COMPLETED"]))
    .optional()
    .transform((v) => v ?? "ENROLLED"),
});

export interface ImportKindSpec<T> {
  /** Columns in template order; `required` ones must be present in the header. */
  columns: string[];
  required: string[];
  example: string[];
  parse: (row: Record<string, string>) => z.ZodSafeParseResult<T>;
  apply: (ctx: RowContext, row: T) => Promise<RowOutcome>;
}

/** Finds the user by email, or creates an INVITED one (they're invited after the batch). */
async function userFor(ctx: RowContext, email: string, displayName: string): Promise<string> {
  const u = schema.users;
  const [existing] = await ctx.db
    .select({ id: u.id, status: u.status })
    .from(u)
    .where(eq(u.email, email));
  if (existing !== undefined) {
    if (existing.status === "DEACTIVATED")
      throw new RowError(`${email} belongs to a deactivated account`);
    return existing.id;
  }
  const [created] = await ctx.db
    .insert(u)
    .values({ email, displayName, status: "INVITED", createdAt: ctx.now, updatedAt: ctx.now })
    .returning({ id: u.id });
  if (created === undefined) throw new Error("user insert returned nothing");
  ctx.createdUsers.push(created.id);
  return created.id;
}

const same = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  Object.keys(a).every((k) => a[k] === b[k]);

const students: ImportKindSpec<z.infer<typeof studentRow>> = {
  columns: [
    "email",
    "given_name",
    "middle_name",
    "family_name",
    "title",
    "gender",
    "date_of_birth",
    "phone_whatsapp",
    "matric_number",
    "programme_code",
    "study_mode",
    "cohort_code",
  ],
  required: [
    "email",
    "given_name",
    "family_name",
    "matric_number",
    "programme_code",
    "study_mode",
    "cohort_code",
  ],
  example: [
    "ada.okafor@gmail.com",
    "Ada",
    "",
    "Okafor",
    "Mrs",
    "FEMALE",
    "1990-04-12",
    "+2348031234567",
    "GLIM/DIP/2025/0012",
    "DIP",
    "ONLINE",
    "DIP-2025",
  ],
  parse: (row) => studentRow.safeParse(row),
  async apply(ctx, row) {
    const { db } = ctx;
    const [programme] = await db
      .select({ id: schema.programmes.id })
      .from(schema.programmes)
      .where(eq(schema.programmes.code, row.programme_code));
    if (programme === undefined) throw new RowError(`No programme with code ${row.programme_code}`);
    const [curriculum] = await db
      .select({ id: schema.curricula.id })
      .from(schema.curricula)
      .where(
        and(eq(schema.curricula.programmeId, programme.id), eq(schema.curricula.status, "ACTIVE")),
      );
    if (curriculum === undefined)
      throw new RowError(`Programme ${row.programme_code} has no active curriculum`);
    const [cohort] = await db
      .select({
        id: schema.cohorts.id,
        intakeId: schema.cohorts.intakeId,
        startsOn: schema.intakes.startsOn,
      })
      .from(schema.cohorts)
      .innerJoin(schema.intakes, eq(schema.intakes.id, schema.cohorts.intakeId))
      .where(
        and(eq(schema.cohorts.programmeId, programme.id), eq(schema.cohorts.code, row.cohort_code)),
      );
    if (cohort === undefined)
      throw new RowError(`No ${row.programme_code} cohort with code ${row.cohort_code}`);

    const userId = await userFor(ctx, row.email, `${row.given_name} ${row.family_name}`);
    const profile = {
      givenName: row.given_name,
      middleName: row.middle_name,
      familyName: row.family_name,
      title: row.title,
      gender: row.gender,
      dateOfBirth: row.date_of_birth,
      phoneWhatsapp: row.phone_whatsapp,
    };
    const s = schema.students;
    const [student] = await db.select().from(s).where(eq(s.userId, userId));
    let studentId: string;
    let outcome: RowOutcome = "unchanged";
    if (student === undefined) {
      const [created] = await db
        .insert(s)
        .values({ userId, ...profile, createdAt: ctx.now, updatedAt: ctx.now })
        .returning({ id: s.id });
      if (created === undefined) throw new Error("student insert returned nothing");
      studentId = created.id;
      outcome = "created";
    } else {
      studentId = student.id;
      if (!same(profile, student)) {
        await db
          .update(s)
          .set({ ...profile, updatedAt: ctx.now })
          .where(eq(s.id, studentId));
        outcome = "updated";
      }
    }

    const pe = schema.programmeEnrollments;
    const [enrollment] = await db.select().from(pe).where(eq(pe.matricNumber, row.matric_number));
    if (enrollment === undefined) {
      await db.insert(pe).values({
        studentId,
        programmeId: programme.id,
        curriculumId: curriculum.id,
        intakeId: cohort.intakeId,
        cohortId: cohort.id,
        matricNumber: row.matric_number,
        studyMode: row.study_mode,
        startedOn: cohort.startsOn,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
      return "created";
    }
    if (enrollment.studentId !== studentId || enrollment.programmeId !== programme.id)
      throw new RowError(
        `Matric Number ${row.matric_number} belongs to another student or programme`,
      );
    if (enrollment.studyMode !== row.study_mode || enrollment.cohortId !== cohort.id) {
      await db
        .update(pe)
        .set({
          studyMode: row.study_mode,
          cohortId: cohort.id,
          intakeId: cohort.intakeId,
          updatedAt: ctx.now,
        })
        .where(eq(pe.id, enrollment.id));
      return "updated";
    }
    return outcome;
  },
};

const lecturers: ImportKindSpec<z.infer<typeof lecturerRow>> = {
  columns: ["email", "title", "given_name", "family_name", "kind", "staff_code"],
  required: ["email", "given_name", "family_name"],
  example: ["tunde.bello@glim.edu.ng", "Rev", "Tunde", "Bello", "INTERNAL", "GL-014"],
  parse: (row) => lecturerRow.safeParse(row),
  async apply(ctx, row) {
    const { db } = ctx;
    const l = schema.lecturers;
    const values = {
      title: row.title,
      givenName: row.given_name,
      familyName: row.family_name,
      kind: row.kind,
      staffCode: row.staff_code,
    };
    // Staff code first (it survives an email change), then the account's email.
    const [byCode] =
      row.staff_code === null
        ? []
        : await db.select().from(l).where(eq(l.staffCode, row.staff_code));
    const userId =
      byCode?.userId ?? (await userFor(ctx, row.email, `${row.given_name} ${row.family_name}`));
    const [existing] = byCode ? [byCode] : await db.select().from(l).where(eq(l.userId, userId));
    if (existing === undefined) {
      await db.insert(l).values({ userId, ...values, createdAt: ctx.now, updatedAt: ctx.now });
      return "created";
    }
    if (same(values, existing)) return "unchanged";
    await db
      .update(l)
      .set({ ...values, updatedAt: ctx.now })
      .where(eq(l.id, existing.id));
    return "updated";
  },
};

const courseEnrollments: ImportKindSpec<z.infer<typeof courseEnrollmentRow>> = {
  columns: ["matric_number", "course_code", "cohort_code", "status"],
  required: ["matric_number", "course_code"],
  example: ["GLIM/DIP/2025/0012", "BIB101", "DIP-2025", "COMPLETED"],
  parse: (row) => courseEnrollmentRow.safeParse(row),
  async apply(ctx, row) {
    const { db } = ctx;
    const pe = schema.programmeEnrollments;
    const [enrollment] = await db.select().from(pe).where(eq(pe.matricNumber, row.matric_number));
    if (enrollment === undefined)
      throw new RowError(`No student with Matric Number ${row.matric_number}`);
    const o = schema.courseOfferings;
    const cohort = schema.cohorts;
    const [offering] = await db
      .select({ id: o.id })
      .from(o)
      .innerJoin(schema.courses, eq(schema.courses.id, o.courseId))
      .innerJoin(cohort, eq(cohort.id, o.cohortId))
      .where(
        and(
          eq(schema.courses.code, row.course_code),
          row.cohort_code === null
            ? eq(o.cohortId, enrollment.cohortId)
            : eq(cohort.code, row.cohort_code),
          ne(o.status, "CANCELLED"),
        ),
      );
    if (offering === undefined)
      throw new RowError(
        `No offering of ${row.course_code} for cohort ${row.cohort_code ?? "of the student"}`,
      );

    const ce = schema.courseEnrollments;
    const [existing] = await db
      .select()
      .from(ce)
      .where(
        and(
          eq(ce.studentId, enrollment.studentId),
          eq(ce.courseOfferingId, offering.id),
          inArray(ce.status, ["ENROLLED", "COMPLETED"]),
        ),
      );
    if (existing !== undefined) {
      if (existing.status === row.status) return "unchanged";
      await db
        .update(ce)
        .set({ status: row.status, updatedAt: ctx.now })
        .where(eq(ce.id, existing.id));
      await db.insert(schema.courseEnrollmentEvents).values({
        courseEnrollmentId: existing.id,
        fromStatus: existing.status,
        toStatus: row.status,
        reason: "Imported",
        createdAt: ctx.now,
      });
      return "updated";
    }
    const [created] = await db
      .insert(ce)
      .values({
        programmeEnrollmentId: enrollment.id,
        courseOfferingId: offering.id,
        studentId: enrollment.studentId,
        selection: "MANUAL",
        status: row.status,
        enrolledAt: ctx.now,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .returning({ id: ce.id });
    if (created === undefined) throw new Error("course enrollment insert returned nothing");
    await db.insert(schema.courseEnrollmentEvents).values({
      courseEnrollmentId: created.id,
      fromStatus: null,
      toStatus: row.status,
      reason: "Imported",
      createdAt: ctx.now,
    });
    return "created";
  },
};

const courseResultRow = z.object({
  matric_number: z.string().trim().toUpperCase().min(1).max(40),
  course_code: z.string().trim().toUpperCase().min(1).max(20),
  completed_on: z.string().trim().pipe(z.iso.date()),
  result_kind: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => (v === "" ? "GRADED" : v))
    .pipe(z.enum(["GRADED", "EXEMPT", "INCOMPLETE", "WITHDRAWN"]))
    .optional()
    .transform((v) => v ?? "GRADED"),
  percent: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(
      z
        .string()
        .regex(/^\d{1,3}(\.\d{1,2})?$/, "use a percentage with at most two decimal places")
        .refine((v) => parseDecimal(v, 2) <= 10_000, "at most 100")
        .nullable(),
    )
    .optional()
    .transform((v) => v ?? null),
  credits: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(
      z
        .string()
        .regex(/^\d{1,2}(\.\d)?$/, "use credits with at most one decimal place")
        .nullable(),
    )
    .optional()
    .transform((v) => v ?? null),
});

/** Past results of current students (D-04): APPROVED, so they count toward CGPA. */
const courseResults: ImportKindSpec<z.infer<typeof courseResultRow>> = {
  columns: ["matric_number", "course_code", "completed_on", "percent", "credits", "result_kind"],
  required: ["matric_number", "course_code", "completed_on"],
  example: ["GLIM/DIP/2025/0012", "BIB101", "2025-10-31", "72", "", "GRADED"],
  parse: (row) => courseResultRow.safeParse(row),
  async apply(ctx, row) {
    const { db } = ctx;
    const pe = schema.programmeEnrollments;
    const [enrollment] = await db
      .select({ id: pe.id })
      .from(pe)
      .where(eq(pe.matricNumber, row.matric_number));
    if (enrollment === undefined)
      throw new RowError(`No student with Matric Number ${row.matric_number}`);
    const [course] = await db
      .select({ id: schema.courses.id })
      .from(schema.courses)
      .where(eq(schema.courses.code, row.course_code));
    if (course === undefined) throw new RowError(`No course ${row.course_code}`);
    if (row.result_kind === "GRADED" && row.percent === null)
      throw new RowError("percent: a graded result needs a percent");
    const recorded = await recordImportedResult(
      db,
      {
        programmeEnrollmentId: enrollment.id,
        completedOn: row.completed_on,
        courseId: course.id,
        creditsX10: row.credits === null ? null : parseDecimal(row.credits, 1),
        finalPctX100: row.percent === null ? null : parseDecimal(row.percent, 2),
        resultKind: row.result_kind,
      },
      ctx.now,
    );
    if (!recorded.ok) throw new RowError(recorded.error.message);
    return recorded.value;
  },
};

/** A kind ready to run: validates a raw row, then applies it (validation failures are row errors). */
export interface RunnableKind {
  columns: string[];
  required: string[];
  example: string[];
  applyRow: (ctx: RowContext, raw: Record<string, string>) => Promise<RowOutcome>;
}

function runnable<T>(spec: ImportKindSpec<T>): RunnableKind {
  return {
    columns: spec.columns,
    required: spec.required,
    example: spec.example,
    applyRow: async (ctx, raw) => {
      const parsed = spec.parse(raw);
      if (!parsed.success)
        throw new RowError(
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        );
      return spec.apply(ctx, parsed.data);
    },
  };
}

export const IMPORT_KIND_SPECS: Record<ImportKind, RunnableKind> = {
  STUDENTS: runnable(students),
  LECTURERS: runnable(lecturers),
  COURSE_ENROLLMENTS: runnable(courseEnrollments),
  COURSE_RESULTS: runnable(courseResults),
};
