import { linkToken } from "./mailbox";
import { expect, test } from "./test";
import { openArea } from "./nav";

const EMAIL = "e2e-opspage@glim.test";
const PASSWORD = "ops passphrase 2026";

/**
 * TRD §15.3, §20.1: the System Admin checks YouTube from the ops page on a phone (the check runs
 * in the background) and looks at the job queues.
 */
test("the System Admin checks YouTube and the job queues", async ({ page }) => {
  await page.goto(`/invite/${await linkToken(EMAIL, "invite")}`);
  await page.getByLabel("New password (at least 12 characters)").fill(PASSWORD);
  await page.getByLabel("Confirm the new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await openArea(page, "Ops");

  const youtube = page.getByRole("region", { name: "YouTube" });
  await expect(youtube).toContainText("Not checked yet.");
  await youtube.getByRole("button", { name: "Check now" }).click();
  await expect(youtube).toContainText("Working", { timeout: 15_000 });
  await expect(youtube).toContainText("Link checks (oEmbed): reachable");
  await expect(youtube).toContainText("✓ https://www.youtube.com/@glimbiblecollege");

  await page.getByRole("link", { name: "Job queues" }).click();
  await expect(page.getByRole("heading", { name: "Job queues" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "ops.youtube-check" })).toBeVisible();
});
