import type { EnumValue } from "@glim/contracts";
import { Db, schema } from "@glim/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { lecturerName } from "./lecturers.service";

export interface AssignmentView {
  id: string;
  lecturerId: string;
  lecturerName: string;
  role: EnumValue<"lecturer_assignments.role">;
  status: EnumValue<"lecturer_assignments.status">;
}

export interface OfferingView {
  id: string;
  courseId: string;
  courseCode: string;
  title: string;
  credits: string;
  semesterId: string;
  semesterName: string;
  sessionCode: string;
  sectionCode: string;
  capacity: number | null;
  status: EnumValue<"course_offerings.status">;
  version: number;
  lecturers: AssignmentView[];
}

/**
 * Course Offerings as people see them: with course, semester and Lecturers. Lists filter in SQL
 * by who may see each offering (§7.2 VisibleOfferings), never one item at a time.
 */
@Injectable()
export class OfferingViewsService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async detail(offeringId: string): Promise<OfferingView | null> {
    const [view] = await this.query(eq(schema.courseOfferings.id, offeringId));
    return view ?? null;
  }

  /**
   * Every offering for staff who can read them all; otherwise only the offerings the user has
   * access to through `v_offering_access` (their own as a Lecturer, later as a student).
   */
  listVisible(input: {
    userId: string;
    seeAll: boolean;
    semesterId?: string | undefined;
    status?: string | undefined;
  }): Promise<OfferingView[]> {
    const o = schema.courseOfferings;
    const conditions: SQL[] = [];
    if (input.semesterId !== undefined) conditions.push(eq(o.semesterId, input.semesterId));
    if (input.status !== undefined) conditions.push(eq(o.status, input.status));
    if (!input.seeAll) {
      conditions.push(
        sql`${o.id} IN (SELECT course_offering_id FROM v_offering_access WHERE user_id = ${input.userId})`,
      );
    }
    return this.query(and(...conditions));
  }

  async assignments(offeringId: string, includeEnded = true): Promise<AssignmentView[]> {
    return (await this.assignmentsFor([offeringId], includeEnded)).get(offeringId) ?? [];
  }

  private async query(where: SQL | undefined): Promise<OfferingView[]> {
    const o = schema.courseOfferings;
    const c = schema.courses;
    const s = schema.semesters;
    const session = schema.academicSessions;
    const rows = await this.db.read
      .select({ offering: o, course: c, semester: s, sessionCode: session.code })
      .from(o)
      .innerJoin(c, eq(c.id, o.courseId))
      .innerJoin(s, eq(s.id, o.semesterId))
      .innerJoin(session, eq(session.id, s.academicSessionId))
      .where(where)
      .orderBy(asc(s.startsOn), asc(c.code), asc(o.sectionCode));
    const lecturers = await this.assignmentsFor(
      rows.map((r) => r.offering.id),
      false,
    );
    return rows.map((r) => ({
      id: r.offering.id,
      courseId: r.course.id,
      courseCode: r.course.code,
      title: r.offering.titleOverride ?? r.course.title,
      credits: r.course.credits,
      semesterId: r.semester.id,
      semesterName: r.semester.name,
      sessionCode: r.sessionCode,
      sectionCode: r.offering.sectionCode,
      capacity: r.offering.capacity,
      status: r.offering.status as OfferingView["status"],
      version: r.offering.version,
      lecturers: lecturers.get(r.offering.id) ?? [],
    }));
  }

  private async assignmentsFor(
    offeringIds: string[],
    includeEnded: boolean,
  ): Promise<Map<string, AssignmentView[]>> {
    const out = new Map<string, AssignmentView[]>();
    if (offeringIds.length === 0) return out;
    const la = schema.lecturerAssignments;
    const l = schema.lecturers;
    const rows = await this.db.read
      .select({ assignment: la, lecturer: l })
      .from(la)
      .innerJoin(l, eq(l.id, la.lecturerId))
      .where(
        and(
          inArray(la.courseOfferingId, offeringIds),
          includeEnded ? undefined : eq(la.status, "ACTIVE"),
        ),
      )
      .orderBy(
        asc(
          sql`CASE ${la.role} WHEN 'PRIMARY' THEN 0 WHEN 'CO_LECTURER' THEN 1 WHEN 'ASSISTANT' THEN 2 ELSE 3 END`,
        ),
        asc(l.familyName),
      );
    for (const { assignment, lecturer } of rows) {
      const list = out.get(assignment.courseOfferingId) ?? [];
      list.push({
        id: assignment.id,
        lecturerId: lecturer.id,
        lecturerName: lecturerName(lecturer),
        role: assignment.role as AssignmentView["role"],
        status: assignment.status as AssignmentView["status"],
      });
      out.set(assignment.courseOfferingId, list);
    }
    return out;
  }
}
