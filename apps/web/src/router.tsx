import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { meQuery } from "./api/session";
import { LoginPage } from "./routes/login";
import { RootLayout } from "./routes/root";

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: RootLayout });

// Every page is its own chunk (TRD §18.1); only the shell is in the initial bundle.
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async ({ context }) => {
    if ((await context.queryClient.query(meQuery)) === null) throw redirect({ to: "/login" });
  },
  component: lazyRouteComponent(() => import("./routes/home"), "HomePage"),
});

const signedOutOnly = async ({ context }: { context: RouterContext }) => {
  if ((await context.queryClient.query(meQuery)) !== null) throw redirect({ to: "/" });
};

/** `?error=` from the Google callback (contracts: GOOGLE_FAILURES), shown on arrival. */
const errorSearch = (search: Record<string, unknown>): { error?: string } =>
  typeof search.error === "string" ? { error: search.error } : {};

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: errorSearch,
  beforeLoad: signedOutOnly,
  // The sign-in page is the first screen, so it ships in the entry chunk (TRD §18.3).
  component: LoginPage,
});

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/profile",
  validateSearch: (search: Record<string, unknown>): { error?: string; linked?: string } => ({
    ...errorSearch(search),
    ...(typeof search.linked === "string" ? { linked: search.linked } : {}),
  }),
  beforeLoad: async ({ context }) => {
    if ((await context.queryClient.query(meQuery)) === null) throw redirect({ to: "/login" });
  },
  component: lazyRouteComponent(() => import("./routes/profile"), "ProfilePage"),
});

const forgotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot",
  component: lazyRouteComponent(() => import("./routes/forgot"), "ForgotPage"),
});

const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset/$token",
  component: lazyRouteComponent(() => import("./routes/reset"), "ResetPage"),
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  component: lazyRouteComponent(() => import("./routes/invite"), "InvitePage"),
});

/** Staff screens: the server authorizes every call; this only keeps the UI tidy (INV-1). */
const requireRole =
  (...roles: string[]) =>
  async ({ context }: { context: RouterContext }) => {
    const me = await context.queryClient.query(meQuery);
    if (me === null) throw redirect({ to: "/login" });
    if (!me.roles.staff.some((r) => roles.includes(r))) throw redirect({ to: "/" });
  };

const adminUsersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/users",
  beforeLoad: requireRole("SYSTEM_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-users"), "AdminUsersPage"),
});

const adminUserRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/users/$userId",
  beforeLoad: requireRole("SYSTEM_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-user"), "AdminUserPage"),
});

const adminAuditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/audit",
  beforeLoad: requireRole("SYSTEM_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-audit"), "AdminAuditPage"),
});

const adminSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/settings",
  beforeLoad: requireRole("SYSTEM_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-settings"), "AdminSettingsPage"),
});

const adminAcademicRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/academic",
  beforeLoad: requireRole("SYSTEM_ADMIN", "ACADEMIC_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-academic"), "AdminAcademicPage"),
});

const adminCurriculumRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/curricula/$curriculumId",
  beforeLoad: requireRole("SYSTEM_ADMIN", "ACADEMIC_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-curriculum"), "AdminCurriculumPage"),
});

const adminCalendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/calendar",
  beforeLoad: requireRole("SYSTEM_ADMIN", "ACADEMIC_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-calendar"), "AdminCalendarPage"),
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  loginRoute,
  forgotRoute,
  resetRoute,
  inviteRoute,
  profileRoute,
  adminUsersRoute,
  adminUserRoute,
  adminAuditRoute,
  adminSettingsRoute,
  adminAcademicRoute,
  adminCurriculumRoute,
  adminCalendarRoute,
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: false });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
