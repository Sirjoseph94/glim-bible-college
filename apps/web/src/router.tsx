import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { meQuery } from "./api/session";
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

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: signedOutOnly,
  component: lazyRouteComponent(() => import("./routes/login"), "LoginPage"),
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

const routeTree = rootRoute.addChildren([
  homeRoute,
  loginRoute,
  forgotRoute,
  resetRoute,
  inviteRoute,
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: false });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
