import { z } from "zod";
import { endpoint } from "../http";

/** The notification centre and email preferences (TRD §15.1), and the SendGrid event webhook. */

export const notificationSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  /** Where in the app it's about, if anywhere. */
  link: z.string().nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type Notification = z.infer<typeof notificationSchema>;

export const getMyNotifications = endpoint({
  method: "GET",
  path: "/me/notifications",
  summary: "The caller's notifications, newest first (kinds they turned off in-app are left out)",
  tag: "Me",
  auth: "session",
  query: z.object({
    /** A notification id: page on from just before it. */
    before: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
  response: z.object({
    items: z.array(notificationSchema),
    unread: z.number().int(),
    nextBefore: z.uuid().nullable(),
  }),
});

export const readNotification = endpoint({
  method: "POST",
  path: "/me/notifications/:id/read",
  summary: "Mark a notification read",
  tag: "Me",
  auth: "session",
  params: z.object({ id: z.uuid() }),
  response: z.object({}),
  successStatus: 204,
});

export const readAllNotifications = endpoint({
  method: "POST",
  path: "/me/notifications/read-all",
  summary: "Mark every notification read",
  tag: "Me",
  auth: "session",
  response: z.object({ count: z.number().int() }),
  successStatus: 200,
});

export const notificationPreferenceSchema = z.object({
  kind: z.string(),
  label: z.string(),
  /** Always emailed at once; can't be turned off. */
  critical: z.boolean(),
  inApp: z.boolean(),
  /** Immediate for critical kinds; otherwise in the daily digest. */
  email: z.boolean(),
});

export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export const getNotificationPreferences = endpoint({
  method: "GET",
  path: "/me/notification-preferences",
  summary: "Which kinds the caller gets in the app and by email",
  tag: "Me",
  auth: "session",
  response: z.object({ items: z.array(notificationPreferenceSchema) }),
});

export const setNotificationPreference = endpoint({
  method: "PUT",
  path: "/me/notification-preferences/:kind",
  summary: "Turn a kind on or off in the app and by email (critical kinds stay emailed)",
  tag: "Me",
  auth: "session",
  params: z.object({ kind: z.string().min(1).max(80) }),
  body: z.object({ inApp: z.boolean(), email: z.boolean() }).strict(),
  response: notificationPreferenceSchema,
});

export const sendgridEvents = endpoint({
  method: "POST",
  path: "/integrations/sendgrid/events",
  summary:
    "SendGrid's signed Event Webhook: verified, stored in the inbox, then processed (bounces suppress the address)",
  tag: "Integrations",
  auth: "public",
  signedWebhook: true,
  body: z.array(z.record(z.string(), z.unknown())).max(1000),
  response: z.object({}),
  successStatus: 204,
});
