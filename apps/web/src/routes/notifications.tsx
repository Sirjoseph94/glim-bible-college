import type { Notification, NotificationPreference, notifications } from "@glim/contracts";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { api } from "../api/client";
import { Alert } from "../components/form";
import { Time } from "../components/time";
import { useSubmit } from "../components/use-submit";

export const notificationsKey = ["notifications"];

/**
 * The notification centre (TRD §15.1): everything in-app, newest first, and which kinds come by
 * email. Critical ones always do; the rest arrive in a daily summary at 06:00.
 */
export function NotificationsPage() {
  const queryClient = useQueryClient();
  const list = useInfiniteQuery({
    queryKey: notificationsKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api<typeof notifications.getMyNotifications>("GET", "/me/notifications", {
        query: pageParam === undefined ? { limit: 20 } : { limit: 20, before: pageParam },
        signal,
      }),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const { busy, error, run } = useSubmit();
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const unread = list.data?.pages[0]?.unread ?? 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-title">Notifications</h1>
        {unread > 0 ? (
          <button
            type="button"
            disabled={busy}
            className="text-sm text-brand underline"
            onClick={() => {
              void run(async () => {
                await api<typeof notifications.readAllNotifications>(
                  "POST",
                  "/me/notifications/read-all",
                  {},
                );
                await queryClient.invalidateQueries({ queryKey: notificationsKey });
              });
            }}
          >
            Mark all read ({unread})
          </button>
        ) : null}
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {list.isPending ? <div className="h-24 animate-pulse rounded bg-slate-200" /> : null}
      {list.isSuccess && items.length === 0 ? (
        <p className="text-sm text-slate-600">Nothing yet.</p>
      ) : null}
      <ul className="space-y-2 text-sm">
        {items.map((n) => (
          <Item key={n.id} notification={n} />
        ))}
      </ul>
      {list.hasNextPage ? (
        <button
          type="button"
          disabled={list.isFetchingNextPage}
          className="text-sm text-brand underline"
          onClick={() => {
            void list.fetchNextPage();
          }}
        >
          Older
        </button>
      ) : null}
      <Preferences />
    </div>
  );
}

function Item({ notification: n }: { notification: Notification }) {
  const queryClient = useQueryClient();
  const markRead = () => {
    if (n.readAt !== null) return;
    void api<typeof notifications.readNotification>("POST", "/me/notifications/:id/read", {
      params: { id: n.id },
    }).then(() => queryClient.invalidateQueries({ queryKey: notificationsKey }));
  };
  return (
    <li
      aria-label={n.title}
      className={`rounded border p-3 ${n.readAt === null ? "border-brand/40 bg-white" : "border-slate-200 bg-slate-50"}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={n.readAt === null ? "font-medium" : ""}>{n.title}</span>
        <span className="text-xs text-slate-500">
          <Time value={n.createdAt} />
        </span>
      </div>
      {n.body === null ? null : <p className="text-slate-700">{n.body}</p>}
      <div className="flex gap-3">
        {n.link === null ? null : (
          <Link to={n.link} className="text-brand underline" onClick={markRead}>
            Open
          </Link>
        )}
        {n.readAt === null ? (
          <button type="button" className="text-slate-600 underline" onClick={markRead}>
            Mark read
          </button>
        ) : null}
      </div>
    </li>
  );
}

function Preferences() {
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: ({ signal }) =>
      api<typeof notifications.getNotificationPreferences>("GET", "/me/notification-preferences", {
        signal,
      }),
  });
  const { error, run } = useSubmit();
  const save = (
    p: NotificationPreference,
    change: Partial<Pick<NotificationPreference, "inApp" | "email">>,
  ) => {
    void run(async () => {
      await api<typeof notifications.setNotificationPreference>(
        "PUT",
        "/me/notification-preferences/:kind",
        { params: { kind: p.kind }, body: { inApp: p.inApp, email: p.email, ...change } },
      );
      await queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
      await queryClient.invalidateQueries({ queryKey: notificationsKey });
    });
  };
  return (
    <details className="rounded border border-slate-200 bg-white p-3 text-sm">
      <summary className="cursor-pointer font-medium">What you get</summary>
      <p className="mt-2 text-slate-600">
        Important messages are always emailed straight away. Everything else comes in one summary
        email at 06:00, never between 21:00 and 06:00 where you are.
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <table className="mt-2 w-full text-left">
        <thead className="text-slate-600">
          <tr>
            <th className="font-normal">Kind</th>
            <th className="font-normal">In the app</th>
            <th className="font-normal">Email</th>
          </tr>
        </thead>
        <tbody>
          {(prefs.data?.items ?? []).map((p) => (
            <PreferenceRow key={p.kind} preference={p} onSave={save} />
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** One kind's switches; they move at once, and the choice is saved behind them. */
function PreferenceRow({
  preference,
  onSave,
}: {
  preference: NotificationPreference;
  onSave: (
    p: NotificationPreference,
    change: Partial<Pick<NotificationPreference, "inApp" | "email">>,
  ) => void;
}) {
  const [choice, setChoice] = useState({ inApp: preference.inApp, email: preference.email });
  const change = (next: Partial<typeof choice>) => {
    const merged = { ...choice, ...next };
    setChoice(merged);
    onSave({ ...preference, ...merged }, next);
  };
  return (
    <tr className="border-t border-slate-100">
      <td className="py-1 pr-2">{preference.label}</td>
      <td>
        <input
          type="checkbox"
          aria-label={`${preference.label} in the app`}
          checked={choice.inApp}
          onChange={(e) => {
            change({ inApp: e.target.checked });
          }}
        />
      </td>
      <td>
        {preference.critical ? (
          <span className="text-slate-500">Always</span>
        ) : (
          <input
            type="checkbox"
            aria-label={`${preference.label} by email`}
            checked={choice.email}
            onChange={(e) => {
              change({ email: e.target.checked });
            }}
          />
        )}
      </td>
    </tr>
  );
}
