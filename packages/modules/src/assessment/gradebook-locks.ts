import { schema, type Database } from "@glim/db";
import { domainError, type DomainError } from "@glim/shared";
import { and, eq, inArray } from "drizzle-orm";

/** Refused while results are finalized (§14.3). */
export const gradebookLocked = (): DomainError =>
  domainError(
    "GRADEBOOK_LOCKED",
    "Results for this course are finalized. Ask the Registrar to reopen a result to change it.",
  );

/** Whether finalization has frozen this student's grades on the course. */
export async function studentLocked(
  db: Database,
  offeringId: string,
  studentId: string,
): Promise<boolean> {
  const l = schema.gradebookLocks;
  const [row] = await db
    .select({ id: l.id })
    .from(l)
    .where(and(eq(l.courseOfferingId, offeringId), eq(l.studentId, studentId)));
  return row !== undefined;
}

/**
 * Whether any result on the course is finalized: then its columns and weights can't change, since
 * finalized results were computed from them.
 */
export async function offeringLocked(db: Database, offeringId: string): Promise<boolean> {
  const l = schema.gradebookLocks;
  const [row] = await db
    .select({ id: l.id })
    .from(l)
    .where(eq(l.courseOfferingId, offeringId))
    .limit(1);
  return row !== undefined;
}

/** Freezes students' grades, inside finalization's transaction; locking again changes nothing. */
export async function lockStudents(
  db: Database,
  offeringId: string,
  studentIds: string[],
  now: Date,
): Promise<void> {
  if (studentIds.length === 0) return;
  await db
    .insert(schema.gradebookLocks)
    .values(
      studentIds.map((studentId) => ({ courseOfferingId: offeringId, studentId, createdAt: now })),
    )
    .onConflictDoNothing();
}

/** Unfreezes a student's grades when their result is reopened. */
export async function unlockStudents(
  db: Database,
  offeringId: string,
  studentIds: string[],
): Promise<void> {
  if (studentIds.length === 0) return;
  const l = schema.gradebookLocks;
  await db
    .delete(l)
    .where(and(eq(l.courseOfferingId, offeringId), inArray(l.studentId, studentIds)));
}
