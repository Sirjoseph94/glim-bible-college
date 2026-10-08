import { pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { programmes } from "./academic";
import { intakes } from "./admissions";
import { citext, enumCheck, std } from "./columns";

/**
 * Owner: academic. The students of one programme who start in one intake, created on the first
 * acceptance (TRD §6.3). In its own file because it joins academic and admissions tables.
 */
export const cohorts = pgTable(
  "cohorts",
  {
    ...std(),
    programmeId: uuid("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "restrict" }),
    intakeId: uuid("intake_id")
      .notNull()
      .references(() => intakes.id, { onDelete: "restrict" }),
    code: citext().notNull(),
    name: text().notNull(),
    status: text().notNull().default("ACTIVE"),
  },
  (t) => [
    unique("cohorts_programme_intake").on(t.programmeId, t.intakeId),
    unique("cohorts_programme_code").on(t.programmeId, t.code),
    enumCheck("cohorts.status", t.status),
  ],
);
