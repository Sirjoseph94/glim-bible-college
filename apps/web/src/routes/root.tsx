import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Outlet, useNavigate } from "@tanstack/react-router";
import type { notifications } from "@glim/contracts";
import { api } from "../api/client";
import { institutionQuery } from "../api/institution";
import { useEffect } from "react";
import { meQuery, signOut, updateMe } from "../api/session";
import { AppShell, SignedOutShell } from "../components/app/app-shell";
import { browserTimeZone } from "../components/time";

export function RootLayout() {
  const institution = useQuery(institutionQuery);
  const me = useQuery(meQuery);
  // The unread count for the nav; marking things read refreshes it (same key prefix).
  const unread = useQuery({
    queryKey: ["notifications", "count"],
    enabled: me.data != null,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      api<typeof notifications.getMyNotifications>("GET", "/me/notifications", {
        query: { limit: 1 },
        signal,
      }),
  });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // The first time someone signs in, adopt the browser's timezone (§5.1); they can change it later.
  const needsTimezone = me.data !== undefined && me.data !== null && !me.data.user.timezoneSet;
  useEffect(() => {
    const zone = browserTimeZone();
    if (needsTimezone && zone !== null)
      void updateMe(queryClient, { timezone: zone }).catch(() => undefined);
  }, [needsTimezone, queryClient]);

  const signOutAndLeave = () => {
    void signOut(queryClient).then(() => navigate({ to: "/login" }));
  };

  if (!me.data)
    return (
      <SignedOutShell institutionName={institution.data?.name}>
        <Outlet />
      </SignedOutShell>
    );
  return (
    <AppShell
      me={me.data}
      institutionName={institution.data?.name}
      unread={(unread.data?.unread ?? 0) > 0}
      onSignOut={signOutAndLeave}
    >
      <Outlet />
    </AppShell>
  );
}
