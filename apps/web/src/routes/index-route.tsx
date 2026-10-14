import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { meQuery } from "../api/session";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";

import { LandingPage } from "./landing";

// Home is its own chunk (TRD §18.1). The landing page is in the initial bundle: it is the first
// screen for most visitors, and a separate chunk would take it past 12 requests (handoff §14).
const HomePage = lazy(() => import("./home").then((m) => ({ default: m.HomePage })));

/** `/`: the person's Home when signed in, else the public landing page (decision D-UI-02). */
export function IndexRoute() {
  const { data: me } = useQuery(meQuery);
  return me ? (
    <Suspense
      fallback={
        // §10.1: a skeleton in the shape of Home (the greeting, then the first card).
        <SkeletonGroup label="Loading your Home">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-32" />
        </SkeletonGroup>
      }
    >
      <HomePage />
    </Suspense>
  ) : (
    <LandingPage />
  );
}
