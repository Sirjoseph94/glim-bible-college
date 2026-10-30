import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContactPage, LEGAL_CONTACT, LEGAL_NAME, PrivacyPage, TermsPage } from "./legal";

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

  it("says what Google sign-in gives us, with the Limited Use statement and how to revoke it", () => {
    expect(html).toContain('id="privacy-google"');
    for (const field of ["Google account ID", "email address", "name", "domain"])
      expect(html).toContain(field);
    expect(html).toContain("including the Limited Use requirements");
    expect(html).toContain(
      'href="https://developers.google.com/terms/api-services-user-data-policy"',
    );
    expect(html).toContain('href="https://myaccount.google.com/connections"');
  });

  it("points to the data download on the Profile page", () => {
    expect(html).toContain("Download my data");
  });
});

describe("the terms of service", () => {
  const html = render(<TermsPage />);

  it("links to the privacy policy and the contact page", () => {
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="https://glimbiblecollege.com/contact"');
  });

  it("names only the Google data the app keeps, as the privacy policy does", () => {
    expect(html).toContain("such as your name and email address");
    expect(html).not.toContain("picture");
  });
});

describe("the contact page", () => {
  const html = render(<ContactPage />);

  it("gives the college's email and points to applying, the privacy policy and the terms", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(`href="mailto:${LEGAL_CONTACT}"`);
    for (const href of ["/apply", "/privacy", "/terms"]) expect(html).toContain(`href="${href}"`);
  });
});
