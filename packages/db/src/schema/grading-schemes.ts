import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { enumCheck, std, tstz } from "./columns";

/** A letter band: percentages `minX100`–`maxX100` (inclusive) earn `letter` and `pointsX100`. */
export interface GradeBand {
  minX100: number;
  maxX100: number;
  letter: string;
  pointsX100: number;
  pass: boolean;
}

/** An award class: a final CGPA from `minCgpaX100` to `maxCgpaX100` (inclusive). */
export interface ClassBand {
  minCgpaX100: number;
  maxCgpaX100: number;
  label: string;
}

/**
 * Owner: results (TRD §6.8, §14.4). How percentages become letters and points, how repeats count,
 * the good-standing line and the award classes. Immutable once used (`locked_at`, set by the
 * first finalized result): changes are a new row that `supersedes_id` the old one.
 */
export const gradingSchemes = pgTable(
  "grading_schemes",
  {
    ...std(),
    name: text().notNull().unique(),
    kind: text().notNull().default("NUC_5"),
    bands: jsonb().$type<GradeBand[]>().notNull(),
    classBands: jsonb("class_bands").$type<ClassBand[]>().notNull(),
    minAwardCgpaX100: integer("min_award_cgpa_x100").notNull().default(100),
    maxPointsX100: integer("max_points_x100").notNull(),
    passMarkX100: integer("pass_mark_x100").notNull(),
    repeatPolicy: text("repeat_policy").notNull().default("BEST"),
    goodStandingCgpaX100: integer("good_standing_cgpa_x100").notNull().default(100),
    probationCgpaX100: integer("probation_cgpa_x100"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => gradingSchemes.id, {
      onDelete: "restrict",
    }),
    lockedAt: tstz("locked_at"),
  },
  (t) => [
    enumCheck("grading_schemes.kind", t.kind),
    enumCheck("grading_schemes.repeat_policy", t.repeatPolicy),
    check("grading_schemes_max_points_check", sql`${t.maxPointsX100} BETWEEN 1 AND 1000`),
    check("grading_schemes_pass_mark_check", sql`${t.passMarkX100} BETWEEN 0 AND 10000`),
    check(
      "grading_schemes_standing_check",
      sql`${t.goodStandingCgpaX100} >= 0 AND (${t.probationCgpaX100} IS NULL OR ${t.probationCgpaX100} < ${t.goodStandingCgpaX100})`,
    ),
  ],
);
