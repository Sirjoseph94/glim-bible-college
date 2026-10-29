import type { Me } from "@glim/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { meQuery } from "../../api/session";
import type { StaffRole } from "../../api/users";
import { SetupHint } from "./setup-hint";

/** Links need a router to build their href; this one has no pages. */
const router = createRouter({
  routeTree: createRootRoute(),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

function render(staff: StaffRole[]) {
  const client = new QueryClient();
  client.setQueryData(meQuery.queryKey, { roles: { staff } } as unknown as Me);
  return renderToStaticMarkup(
    <RouterContextProvider router={router}>
      <QueryClientProvider client={client}>
        <SetupHint missing="No upcoming Academic Session yet." fix="create one" place="calendar" />
      </QueryClientProvider>
    </RouterContextProvider>,
  );
}

describe("SetupHint", () => {
  it("links to the page that fixes it when the viewer can open that page", () => {
    const html = render(["ACADEMIC_ADMIN"]);
    expect(html).toContain("No upcoming Academic Session yet. Create one on the");
    expect(html).toMatch(/<a[^>]*href="\/admin\/calendar"[^>]*>Academic calendar<\/a>/);
  });

  it("says who to ask, without a link, when the viewer can't open that page", () => {
    const html = render(["ADMISSIONS_OFFICER"]);
    expect(html).toContain(
      "No upcoming Academic Session yet. Ask an Academic Admin to create one on the Academic calendar page.",
    );
    expect(html).not.toContain("<a");
  });
});
