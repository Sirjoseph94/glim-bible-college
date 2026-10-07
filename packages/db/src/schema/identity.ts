import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bytea, citext, enumCheck, inet, std, stdRo, tstz } from "./columns";

/** Owner: identity (TRD §6.2). */
export const users = pgTable(
  "users",
  {
    ...std(),
    email: citext().notNull().unique(),
    displayName: text("display_name").notNull(),
    status: text().notNull().default("INVITED"),
    passwordHash: text("password_hash"),
    passwordChangedAt: tstz("password_changed_at"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: tstz("locked_until"),
    timezone: text(),
    emailStatus: text("email_status").notNull().default("OK"),
    referralCode: text("referral_code").unique(),
    locale: text().notNull().default("en"),
    lastLoginAt: tstz("last_login_at"),
  },
  (t) => [enumCheck("users.status", t.status), enumCheck("users.email_status", t.emailStatus)],
);

/** Owner: identity. Google `sub` links a user to their Google account (§8.1). */
export const identities = pgTable(
  "identities",
  {
    ...stdRo(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    provider: text().notNull(),
    subject: text().notNull(),
    email: citext(),
    metadata: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
    verifiedAt: tstz("verified_at"),
  },
  (t) => [
    uniqueIndex("identities_provider_subject").on(t.provider, t.subject),
    enumCheck("identities.provider", t.provider),
  ],
);

/** Owner: identity. Only SHA-256(token) is stored (§8.3). */
export const authSessions = pgTable(
  "auth_sessions",
  {
    ...stdRo(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    tokenHash: bytea("token_hash").notNull().unique(),
    expiresAt: tstz("expires_at").notNull(),
    idleExpiresAt: tstz("idle_expires_at").notNull(),
    lastSeenAt: tstz("last_seen_at").notNull().defaultNow(),
    ip: inet(),
    userAgent: text("user_agent"),
    revokedAt: tstz("revoked_at"),
    csrfSecret: bytea("csrf_secret").notNull(),
  },
  (t) => [
    index("auth_sessions_user_active")
      .on(t.userId)
      .where(sql`revoked_at IS NULL`),
  ],
);

/**
 * Owner: identity. Single-use invite and password-reset tokens (§8.1), stored as SHA-256.
 * Not in the TRD DDL, which names the tokens but no table for them.
 */
export const authTokens = pgTable(
  "auth_tokens",
  {
    ...stdRo(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    purpose: text().notNull(),
    tokenHash: bytea("token_hash").notNull().unique(),
    expiresAt: tstz("expires_at").notNull(),
    usedAt: tstz("used_at"),
    createdBy: uuid("created_by"),
  },
  (t) => [
    enumCheck("auth_tokens.purpose", t.purpose),
    index("auth_tokens_user_open")
      .on(t.userId, t.purpose)
      .where(sql`used_at IS NULL`),
  ],
);

export type UserRow = typeof users.$inferSelect;

/** Owner: identity. Versioned and append-only: a change is a new row (§6.2). */
export const policies = pgTable(
  "policies",
  {
    ...stdRo(),
    policyType: text("policy_type").notNull(),
    scopeType: text("scope_type").notNull().default("INSTITUTION"),
    scopeId: uuid("scope_id"),
    policyVersion: integer("policy_version").notNull(),
    config: jsonb().notNull(),
    effectiveFrom: tstz("effective_from").notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (t) => [
    enumCheck("policies.policy_type", t.policyType),
    enumCheck("policies.scope_type", t.scopeType),
    check("policies_scope_check", sql`(${t.scopeType} = 'INSTITUTION') = (${t.scopeId} IS NULL)`),
  ],
);
