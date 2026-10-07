import { sql } from "drizzle-orm";
import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { enumCheck, stdRo, tstz } from "./columns";
import { users } from "./identity";

/**
 * Owner: authorization. Staff roles only, institution-wide (§6.2). Lecturer, Student and
 * Applicant are derived (§7.1) and never rows here.
 */
export const roleAssignments = pgTable(
  "role_assignments",
  {
    ...stdRo(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: text().notNull(),
    grantedBy: uuid("granted_by"),
    revokedAt: tstz("revoked_at"),
    reason: text(),
  },
  (t) => [
    enumCheck("role_assignments.role", t.role),
    uniqueIndex("role_assignments_active")
      .on(t.userId, t.role)
      .where(sql`revoked_at IS NULL`),
  ],
);
