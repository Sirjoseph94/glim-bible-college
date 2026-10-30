import { describe, expect, it } from "vitest";
import { PRERENDERED, renderPage } from "./prerender";
import { LEGAL_CONTACT, LEGAL_NAME } from "./routes/legal";

describe("prerendered pages", () => {
  it.each(PRERENDERED)("$path renders its whole text without JavaScript", (entry) => {
    const html = renderPage(entry);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(LEGAL_NAME);
    expect(html).toContain(`mailto:${LEGAL_CONTACT}`);
    // Enough prose for a reviewer to read, not a shell waiting for scripts.
    const words = html
      .replace(/<[^>]*>/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    expect(words.length).toBeGreaterThan(400);
  });

  it("includes the Google sign-in section that Google's OAuth review looks for", () => {
    const privacy = PRERENDERED.find((p) => p.path === "/privacy");
    expect(privacy).toBeDefined();
    if (privacy === undefined) return;
    expect(renderPage(privacy)).toContain("including the Limited Use requirements");
    expect(privacy.title).toBe(`Privacy policy · ${LEGAL_NAME}`);
  });
});
