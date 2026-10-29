import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LEGAL_CONTACT, LEGAL_NAME, PrivacyPage, TermsPage } from "./legal";

/** Links need a router to build their href; this one has no pages. */
const router = createRouter({
  routeTree: createRootRoute(),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

function render(page: React.ReactElement) {
  return renderToStaticMarkup(
    <RouterContextProvider router={router}>{page}</RouterContextProvider>,
  );
}

describe.each([
  ["privacy policy", <PrivacyPage key="privacy" />],
  ["terms of service", <TermsPage key="terms" />],
])("the %s", (_, page) => {
  const html = render(page);

  it("has one page heading and section headings with unique ids", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    const ids = [...html.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(3);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names the college and how to reach it", () => {
    expect(html).toContain(LEGAL_NAME);
    expect(html).toContain(`href="mailto:${LEGAL_CONTACT}"`);
  });
});

describe("the privacy policy", () => {
  const html = render(<PrivacyPage />);

  it("lists every cookie the server sets (session.service, google-sign-in.service, ops.controller)", () => {
    for (const cookie of ["__Host-glim_sid", "__Host-glim_oidc", "glim_youtube_state"])
      expect(html).toContain(cookie);
  });

  it("names every processor in docs/compliance/ropa.md", () => {
    for (const processor of ["Hostinger", "Neon", "Cloudflare", "Google", "Brevo"])
      expect(html).toContain(processor);
  });

  it("points to the data download on the Profile page", () => {
    expect(html).toContain("Download my data");
  });
});

describe("the terms of service", () => {
  it("links to the privacy policy", () => {
    expect(render(<TermsPage />)).toContain('href="/privacy"');
  });
});
