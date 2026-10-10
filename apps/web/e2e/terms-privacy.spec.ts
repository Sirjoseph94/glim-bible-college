import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "./test";
import { openArea, signOut } from "./nav";

const STUDENT = { email: "e2e-student2@glim.test", password: "student passphrase 2026" };
/** Set in the ops spec. */
const ADMIN = { email: "e2e-opspage@glim.test", password: "ops passphrase 2026" };

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^Welcome/ })).toBeVisible();
}

/**
 * TRD §19.4: runs last. A graduate downloads everything held about them; then the System Admin
 * erases them, keeping the academic record under a pseudonym.
 */
test("a person downloads their data, then the System Admin erases them", async ({ page }) => {
  await signIn(page, STUDENT);
  await openArea(page, "Profile");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my data" }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toBe("glim-my-data.json");
  const data = JSON.parse(await readFile(await file.path(), "utf8")) as {
    sections: { account: { email: string }; programmeEnrollments: { matricNumber: string }[] };
  };
  expect(data.sections.account.email).toBe(STUDENT.email);
  expect(data.sections.programmeEnrollments[0]?.matricNumber).toBe("GLIM/DIP/2032/0002");
  await signOut(page);

  await signIn(page, ADMIN);
  await openArea(page, "People");
  await page.getByLabel("Search by name or email").fill("Bola");
  await page.getByRole("link", { name: "Bola Online" }).click();
  await page.getByRole("button", { name: "Erase personal data" }).click();
  const erase = page.getByRole("dialog", { name: "Erase this person's personal data?" });
  await erase.getByLabel("Why erase them?").fill("Asked to be forgotten");
  await erase.getByRole("button", { name: "Erase personal data" }).click();
  await expect(page.getByRole("heading", { name: /^Erased [0-9a-f]{10}$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Erase personal data" })).toHaveCount(0);
  await signOut(page);

  // The erased account can't sign in any more.
  await page.goto("/login");
  await page.getByLabel("Email").fill(STUDENT.email);
  await page.getByLabel("Password").fill(STUDENT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});
