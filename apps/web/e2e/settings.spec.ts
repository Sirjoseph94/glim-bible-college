import { expect, test } from "./test";
import { linkToken } from "./mailbox";
import { openArea } from "./nav";

const EMAIL = "e2e-settings@glim.test";
const PASSWORD = "settings passphrase 2026";

test("a System Admin in New York sees Lagos time alongside, renames the college, and versions a policy", async ({
  page,
}) => {
  await page.goto(`/invite/${await linkToken(EMAIL, "invite")}`);
  await page.getByLabel("New password (at least 12 characters)").fill(PASSWORD);
  await page.getByLabel("Confirm the new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Sade Settings" })).toBeVisible();

  await openArea(page, "Profile");
  await page.getByLabel("Your timezone").fill("America/New_York");
  await page.getByRole("button", { name: "Save timezone" }).click();
  await expect(page.getByText(/ New York \(.*Lagos\)/)).toBeVisible();

  await openArea(page, "Settings");
  await page.getByLabel("Institution name").fill("GLIM Bible College");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await expect(page.getByTestId("institution-name")).toHaveText("GLIM Bible College");

  await page.getByText("Joining Class Meetings").click();
  await page.getByLabel("Student opens before minutes").fill("20");
  await page.getByRole("button", { name: "Save a new version" }).first().click();
  await expect(page.getByText("· version 1")).toBeVisible();

  await openArea(page, "Settings");
  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByText("identity.policy.saved")).toBeVisible();
  await expect(page.locator("time").first()).toContainText("Lagos");
});
