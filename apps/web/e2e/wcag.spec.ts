import { expectAccessible, signIn } from "./accessible";
import { expect, test } from "./test";

/**
 * TRD §18, §21.2: axe finds no WCAG 2.1 A/AA violations on the key routes, checked on a phone
 * once each page has loaded its data. Runs last (after the other specs have set passwords and
 * filled the pages with data).
 */

const LECTURER = { email: "e2e-lecturer@glim.test", password: "lecturer passphrase 2026" };
const REGISTRAR = { email: "e2e-registrar@glim.test", password: "registrar passphrase 2026" };
const SYSTEM_ADMIN = { email: "e2e-opspage@glim.test", password: "ops passphrase 2026" };

test("public pages: landing, sign-in, apply, forgotten password, transcript verification, privacy, terms and contact", async ({
  page,
}) => {
  for (const path of [
    "/",
    "/login",
    "/apply",
    "/forgot",
    "/verify/NOTACODE",
    "/privacy",
    "/terms",
    "/contact",
  ])
    await expectAccessible(page, path);
});

test("a Lecturer's pages", async ({ page }) => {
  await signIn(page, LECTURER);
  for (const path of ["/", "/teach", "/notifications", "/profile"])
    await expectAccessible(page, path);
});

test("the Registrar's results pages", async ({ page }) => {
  await signIn(page, REGISTRAR);
  for (const path of [
    "/results/courses",
    "/results/cohorts",
    "/results/awards",
    "/results/transcripts",
    "/admin/grading-schemes",
  ])
    await expectAccessible(page, path);
});

test("the System Admin's pages", async ({ page }) => {
  await signIn(page, SYSTEM_ADMIN);
  for (const path of [
    "/admin/users",
    "/admin/ops",
    "/admin/jobs",
    "/admin/audit",
    "/admin/cohorts",
    "/admin/rooms",
  ])
    await expectAccessible(page, path);
});

test.describe("in the dark theme", () => {
  // The theme follows the device (UI-2); these pages are checked again with a dark device.
  test.use({ colorScheme: "dark" });

  test("public pages", async ({ page }) => {
    for (const path of [
      "/",
      "/login",
      "/apply",
      "/forgot",
      "/verify/NOTACODE",
      "/privacy",
      "/terms",
    ])
      await expectAccessible(page, path);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("a Lecturer's pages", async ({ page }) => {
    await signIn(page, LECTURER);
    for (const path of ["/", "/teach", "/notifications", "/profile"])
      await expectAccessible(page, path);
  });

  test("the Registrar's results pages", async ({ page }) => {
    await signIn(page, REGISTRAR);
    for (const path of ["/results/courses", "/results/cohorts", "/results/transcripts"])
      await expectAccessible(page, path);
  });
});
