import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { enumCheck, std, stdRo, tstz } from "./columns";
import { users } from "./identity";

/**
 * Owner: notifications. In-app notifications, and the email for each where one is due (TRD §15.1).
 * `data` holds what the kind's template needs; never sensitive applicant answers (INV-15).
 */
export const notifications = pgTable(
  "notifications",
  {
    ...stdRo(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    title: text().notNull(),
    body: text(),
    data: jsonb()
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    readAt: tstz("read_at"),
    emailStatus: text("email_status").notNull().default("NOT_REQUESTED"),
    dedupeKey: text("dedupe_key"),
  },
  (t) => [
    enumCheck("notifications.email_status", t.emailStatus),
    unique("notifications_user_dedupe").on(t.userId, t.dedupeKey),
    index("notifications_user_created_idx").on(t.userId, t.createdAt.desc()),
  ],
);

/**
 * Owner: notifications (TRD §6.7, §15.1). A user's choice for one kind: in-app and/or email.
 * No row means both on. Critical kinds are always emailed.
 */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    ...std(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean().notNull().default(true),
  },
  (t) => [unique("notification_preferences_user_kind").on(t.userId, t.kind)],
);

/**
 * Owner: ops (TRD §5.5). The durable inbox for provider events (SendGrid's event webhook): stored
 * before the provider is answered, processed by `provider-event.process`. The payload never
 * changes.
 */
export const providerEvents = pgTable(
  "provider_events",
  {
    ...stdRo(),
    provider: text().notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    subject: text(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    receivedAt: tstz("received_at").notNull().defaultNow(),
    status: text().notNull().default("RECEIVED"),
    attempts: integer().notNull().default(0),
    lastError: text("last_error"),
    processedAt: tstz("processed_at"),
  },
  (t) => [
    enumCheck("provider_events.provider", t.provider),
    enumCheck("provider_events.status", t.status),
    unique("provider_events_once").on(t.provider, t.eventId),
    index("provider_events_pending").on(t.status, t.receivedAt),
  ],
);
