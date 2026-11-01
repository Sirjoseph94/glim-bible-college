import { describe, expect, it } from "vitest";
import { deviceThemeCss, PRERENDERED, renderPage, staticDocument } from "./prerender";
import { LEGAL_CONTACT, LEGAL_NAME } from "./routes/legal";

describe("prerendered pages", () => {
  const LEGAL = PRERENDERED.filter((p) => p.path !== "/contact");

  it("covers the privacy policy, terms and contact page", () => {
    expect(PRERENDERED.map((p) => p.path)).toEqual(["/privacy", "/terms", "/contact"]);
  });

  it.each(LEGAL)("$path renders its whole text without JavaScript", (entry) => {
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

  it("renders the contact page with the college's email", () => {
    const contact = PRERENDERED.find((p) => p.path === "/contact");
    expect(contact).toBeDefined();
    if (contact === undefined) return;
    expect(renderPage(contact)).toContain(`mailto:${LEGAL_CONTACT}`);
  });

  it("includes the Google sign-in section that Google's OAuth review looks for", () => {
    const privacy = PRERENDERED.find((p) => p.path === "/privacy");
    expect(privacy).toBeDefined();
    if (privacy === undefined) return;
    expect(renderPage(privacy)).toContain("including the Limited Use requirements");
    expect(privacy.title).toBe(`Privacy policy · ${LEGAL_NAME}`);
  });

  it("builds a document with no scripts that links the device-theme CSS", () => {
    const template = [
      "<!doctype html>",
      '<html lang="en" data-theme="light">',
      "  <head>",
      "    <title>GLIM Bible College</title>",
      '    <script type="module" crossorigin src="/assets/index-abc123.js"></script>',
      '    <link rel="modulepreload" crossorigin href="/assets/vendor-abc123.js">',
      '    <link rel="stylesheet" crossorigin href="/assets/index-abc123.css">',
      "  </head>",
      "  <body>",
      '    <div id="root"></div>',
      "  </body>",
      "</html>",
    ].join("\n");
    const privacy = PRERENDERED[0];
    if (privacy === undefined) throw new Error("no privacy page");

    const html = staticDocument(template, "/assets/device-theme-1234abcd.css", privacy);
    expect(html).not.toMatch(/<script|modulepreload|data-theme|<style|style=/);
    expect(html).toMatch(
      /index-abc123\.css">\s*<link rel="stylesheet" href="\/assets\/device-theme-1234abcd\.css" \/>/,
    );
    expect(html).toContain(`<title>${privacy.title}</title>`);
    expect(html).toContain('<meta name="description"');
    expect(html).toContain("including the Limited Use requirements");
    expect(() => staticDocument("<body></body>", "/x.css", privacy)).toThrow(/root/);
  });

  it("takes the dark tokens for the device's colour scheme from tokens.css", () => {
    const tokens =
      ':root,\n[data-theme="light"] {\n  --ink: #14201a;\n}\n[data-theme="dark"] {\n  --ink: #ecf2ee;\n}\n';
    expect(deviceThemeCss(tokens)).toMatch(
      /^@media \(prefers-color-scheme: dark\) \{\n {2}:root \{\s*--ink: #ecf2ee;\s*\}\n\}/,
    );
    expect(() => deviceThemeCss(":root {}")).toThrow(/dark/);
  });
});
