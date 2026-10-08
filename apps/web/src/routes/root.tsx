import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { institutionQuery } from "../api/institution";
import { useEffect } from "react";
import { meQuery, signOut, updateMe } from "../api/session";
import { browserTimeZone } from "../components/time";

export function RootLayout() {
  const institution = useQuery(institutionQuery);
  const me = useQuery(meQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // The first time someone signs in, adopt the browser's timezone (§5.1); they can change it later.
  const needsTimezone = me.data !== undefined && me.data !== null && !me.data.user.timezoneSet;
  useEffect(() => {
    const zone = browserTimeZone();
    if (needsTimezone && zone !== null)
      void updateMe(queryClient, { timezone: zone }).catch(() => undefined);
  }, [needsTimezone, queryClient]);

  return (
    <div className="min-h-dvh bg-slate-50 font-sans text-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-brand px-4 py-3 text-white">
        {institution.data ? (
          <h1 className="text-lg font-semibold" data-testid="institution-name">
            {institution.data.name}
          </h1>
        ) : (
          <div className="h-7 w-56 animate-pulse rounded bg-white/20" aria-label="Loading" />
        )}
        {me.data ? (
          <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <Link to="/" className="underline">
              Home
            </Link>
            {me.data.roles.staff.some((r) => r === "SYSTEM_ADMIN" || r === "ADMISSIONS_OFFICER") ? (
              <Link to="/admissions" className="underline">
                Admissions
              </Link>
            ) : null}
            {me.data.roles.isApplicant ? (
              <Link to="/application" className="underline">
                My application
              </Link>
            ) : null}
            {me.data.roles.isStudent ? (
              <>
                <Link to="/courses" className="underline">
                  My courses
                </Link>
                <Link to="/registration" className="underline">
                  Registration
                </Link>
              </>
            ) : null}
            {me.data.roles.isLecturer ? (
              <Link to="/teach" className="underline">
                My offerings
              </Link>
            ) : null}
            <Link to="/profile" className="underline">
              Profile
            </Link>
            {me.data.roles.staff.some((r) => r === "SYSTEM_ADMIN" || r === "ACADEMIC_ADMIN") ? (
              <>
                <Link to="/admin/academic" className="underline">
                  Academic
                </Link>
                <Link to="/admin/calendar" className="underline">
                  Calendar
                </Link>
                <Link to="/admin/offerings" className="underline">
                  Offerings
                </Link>
                <Link to="/admin/lecturers" className="underline">
                  Lecturers
                </Link>
                <Link to="/admin/imports" className="underline">
                  Imports
                </Link>
              </>
            ) : null}
            {me.data.roles.staff.includes("SYSTEM_ADMIN") ? (
              <>
                <Link to="/admin/users" className="underline">
                  Users
                </Link>
                <Link to="/admin/videos" className="underline">
                  Videos
                </Link>
                <Link to="/admin/audit" className="underline">
                  Audit log
                </Link>
                <Link to="/admin/settings" className="underline">
                  Settings
                </Link>
              </>
            ) : null}
            <button
              type="button"
              className="rounded border border-white/40 px-3 py-1 text-sm"
              onClick={() => {
                void signOut(queryClient).then(() => navigate({ to: "/login" }));
              }}
            >
              Sign out
            </button>
          </nav>
        ) : null}
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
