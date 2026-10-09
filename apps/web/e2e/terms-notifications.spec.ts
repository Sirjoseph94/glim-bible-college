import { expect, test, type Page } from "./test";

const STUDENT = { email: "e2e-student2@glim.test", password: "student passphrase 2026" };

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^Welcome/ })).toBeVisible();
}

/**
 * TRD §15.1: runs after the term specs, which left Bola grade, result, award and transcript
 * notifications. On a phone she reads them, marks them read and turns an email kind off.
 */
test("a student reads notifications and chooses what comes by email", async ({ page }) => {
  await signIn(page, STUDENT);
  await page.getByRole("link", { name: /^Notifications \(\d+\)$/ }).click();
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(
    page.getByRole("listitem", { name: /your grade for .* is out/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem", { name: /transcript GLIM\/TR\/\d{4}\/00001 is ready/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: /^Mark all read \(\d+\)$/ }).click();
  await expect(page.getByRole("button", { name: /^Mark all read/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();

  await page.getByText("What you get").click();
  const announcements = page.getByLabel("Course announcements by email");
  await expect(announcements).toBeChecked();
  await announcements.uncheck();
  await expect(announcements).not.toBeChecked();
  await page.reload();
  await page.getByText("What you get").click();
  await expect(page.getByLabel("Course announcements by email")).not.toBeChecked();
  // Critical kinds can't be turned off by email.
  await expect(page.getByRole("row", { name: /Transcript issued/ })).toContainText("Always");
});
