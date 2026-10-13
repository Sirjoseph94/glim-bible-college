import type { Notification, NotificationPreference, notifications } from "@glim/contracts";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { Time } from "../components/time";
import { Badge } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button, buttonClass } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Switch } from "../components/ui/choice";
import { Disclosure } from "../components/ui/disclosure";
import { EmptyState } from "../components/ui/empty-state";
import { NotificationDot } from "../components/ui/notification-dot";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
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
  const { busy, problem, run } = useSubmit();
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const unread = list.data?.pages[0]?.unread ?? 0;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        meta={unread > 0 ? `${String(unread)} new` : "You're up to date."}
        actions={
          unread > 0 ? (
            <Button
              variant="secondary"
              icon="check"
              loading={busy}
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
            </Button>
          ) : undefined
        }
      />
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      {list.isPending ? (
        <SkeletonGroup label="Loading notifications">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </SkeletonGroup>
      ) : list.isError ? (
        <LoadFailed what="your notifications" onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="bell" title="Nothing yet">
          Grades, results, announcements and other news for you appear here.
        </EmptyState>
      ) : (
        <Card list role="list">
          {items.map((n) => (
            <Item key={n.id} notification={n} />
          ))}
        </Card>
      )}
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          loading={list.isFetchingNextPage}
          onClick={() => {
            void list.fetchNextPage();
          }}
        >
          Older
        </Button>
      ) : null}
      <Card>
        <Preferences />
      </Card>
    </div>
  );
}

function Item({ notification: n }: { notification: Notification }) {
  const queryClient = useQueryClient();
  const isNew = n.readAt === null;
  const markRead = () => {
    if (n.readAt !== null) return;
    void api<typeof notifications.readNotification>("POST", "/me/notifications/:id/read", {
      params: { id: n.id },
    }).then(() => queryClient.invalidateQueries({ queryKey: notificationsKey }));
  };
  return (
    <div
      role="listitem"
      aria-label={n.title}
      className={isNew ? "flex gap-3 bg-brand-soft px-4 py-3" : "flex gap-3 px-4 py-3"}
    >
      <span className="w-2 shrink-0 pt-2">{isNew ? <NotificationDot /> : null}</span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={isNew ? "text-subhead text-ink" : "text-body text-ink"}>{n.title}</p>
          {isNew ? <Badge tone="brand">New</Badge> : null}
        </div>
        <p className="text-meta text-ink-muted">
          <Time value={n.createdAt} />
        </p>
        {n.body === null ? null : <p className="text-body-sm text-ink">{n.body}</p>}
        {n.link === null && !isNew ? null : (
          <div className="flex flex-wrap gap-2 pt-1">
            {n.link === null ? null : (
              <Link
                to={n.link}
                className={buttonClass({ variant: "secondary", size: "sm" })}
                onClick={markRead}
              >
                Open
              </Link>
            )}
            {isNew ? (
              <Button variant="quiet" size="sm" onClick={markRead}>
                Mark read
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
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
  const { problem, run } = useSubmit();
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
    <Disclosure summary="What you get">
      <div className="space-y-3">
        <p className="text-body-sm text-ink-muted">
          Important messages are always emailed straight away. Everything else comes in one summary
          email at 06:00, never between 21:00 and 06:00 where you are.
        </p>
        {problem ? (
          <Banner tone="danger" title={problem.title}>
            {problem.body}
          </Banner>
        ) : null}
        {prefs.isPending ? (
          <SkeletonGroup label="Loading your choices">
            <Skeleton className="h-24" />
          </SkeletonGroup>
        ) : prefs.isError ? (
          <LoadFailed what="your choices" onRetry={() => void prefs.refetch()} />
        ) : (
          <div className="divide-y divide-line">
            {prefs.data.items.map((p) => (
              <PreferenceRow key={p.kind} preference={p} onSave={save} />
            ))}
          </div>
        )}
      </div>
    </Disclosure>
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
    <div role="group" aria-label={preference.label} className="py-3">
      <p className="text-subhead text-ink">{preference.label}</p>
      <Switch
        label="In the app"
        checked={choice.inApp}
        onCheckedChange={(checked) => {
          change({ inApp: checked });
        }}
      />
      {preference.critical ? (
        <div className="flex min-h-tap items-center justify-between gap-4">
          <span className="text-label text-ink">By email</span>
          <Badge tone="info">Always</Badge>
        </div>
      ) : (
        <Switch
          label="By email"
          checked={choice.email}
          onCheckedChange={(checked) => {
            change({ email: checked });
          }}
        />
      )}
    </div>
  );
}
