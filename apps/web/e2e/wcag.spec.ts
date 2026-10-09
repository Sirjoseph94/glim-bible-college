import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./test";

/**
 * TRD §18, §21.2: axe finds no WCAG 2.1 A/AA violations on the key routes, checked on a phone
 * once each page has loaded its data. Runs last (after the other specs have set passwords and
 * filled the pages with data).
 */

const LECTURER = { email: "e2e-lecturer@glim.test", password: "lecturer passphrase 2026" };
const REGISTRAR = { email: "e2e-registrar@glim.test", password: "registrar passphrase 2026" };
const SYSTEM_ADMIN = { email: "e2e-opspage@glim.test", password: "ops passphrase 2026" };

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^Welcome/ })).toBeVisible();
}

async function expectAccessible(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const found = violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    targets: v.nodes.map((n) => n.target.join(" ")),
  }));
  expect(found, `axe violations on ${path}`).toEqual([]);
}

test("public pages: sign-in, apply, forgotten password and transcript verification", async ({
  page,
}) => {
  for (const path of ["/login", "/apply", "/forgot", "/verify/NOTACODE"])
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
    "/results/semesters",
    "/results/awards",
    "/results/transcripts",
    "/admin/grading-schemes",
  ])
    await expectAccessible(page, path);
});

test("the System Admin's pages", async ({ page }) => {
  await signIn(page, SYSTEM_ADMIN);
  for (const path of ["/admin/users", "/admin/ops", "/admin/jobs", "/admin/audit"])
    await expectAccessible(page, path);
});
