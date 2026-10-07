import { sql } from "drizzle-orm";
import { check, date, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { academicSessions } from "./academic";
import { citext, enumCheck, std } from "./columns";

/**
 * Owner: admissions. One per year: applications open in November and close in June, and the
 * students start in `academic_session` (TRD §6.3, §10.1).
 */
export const intakes = pgTable(
  "intakes",
  {
    ...std(),
    code: citext().notNull().unique(),
    academicSessionId: uuid("academic_session_id")
      .notNull()
      .unique()
      .references(() => academicSessions.id, { onDelete: "restrict" }),
    opensOn: date("opens_on").notNull(),
    closesOn: date("closes_on").notNull(),
    offerAcceptanceDays: integer("offer_acceptance_days").notNull().default(21),
    status: text().notNull().default("PLANNED"),
  },
  (t) => [
    enumCheck("intakes.status", t.status),
    check("intakes_dates_check", sql`${t.closesOn} > ${t.opensOn}`),
    check("intakes_offer_acceptance_days_check", sql`${t.offerAcceptanceDays} > 0`),
  ],
);
