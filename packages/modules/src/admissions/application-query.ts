import type { Application } from "@glim/contracts";
import { schema, type Database } from "@glim/db";
import { eq, sql, type SQL } from "drizzle-orm";

/** Applications with their intake and programme, as both the applicant and staff views need. */
export function selectApplications(where: SQL | undefined, db: Database, order: SQL[] = []) {
  const a = schema.applications;
  const i = schema.intakes;
  const s = schema.academicSessions;
  const pr = schema.programmes;
  return db
    .select({
      application: a,
      intake: {
        id: i.id,
        code: i.code,
        academicSessionName: s.name,
        startsOn: s.startsOn,
        closesOn: i.closesOn,
        status: sql<Application["intake"]["status"]>`${i.status}`,
      },
      programme: {
        id: pr.id,
        code: pr.code,
        name: pr.name,
        awardType: sql<Application["programme"]["awardType"]>`${pr.awardType}`,
      },
    })
    .from(a)
    .innerJoin(i, eq(i.id, a.intakeId))
    .innerJoin(s, eq(s.id, i.academicSessionId))
    .innerJoin(pr, eq(pr.id, a.programmeId))
    .where(where)
    .orderBy(...order);
}
