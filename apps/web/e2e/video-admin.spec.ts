import { expect, test } from "./test";
import { linkToken, scriptYouTube } from "./mailbox";
import { openArea } from "./nav";

const EMAIL = "e2e-videos@glim.test";
const PASSWORD = "video admin passphrase 2026";

/**
 * AC-19: the System Admin finds a video YouTube stopped serving, replaces its link, deletes it
 * and restores it. Runs after the recordings spec, which adds "Week 2: Prayer" (e2eWatch001).
 */
test("the System Admin manages videos across the college", async ({ page }) => {
  await page.goto(`/invite/${await linkToken(EMAIL, "invite")}`);
  await page.getByLabel("New password (at least 12 characters)").fill(PASSWORD);
  await page.getByLabel("Confirm the new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await openArea(page, "Settings");
  await page.getByRole("link", { name: "Videos" }).click();

  const row = page.getByRole("listitem", { name: "Week 2: Prayer" });
  await expect(row).toContainText("Published");
  await expect(row.getByRole("link", { name: "YouTube Studio" })).toHaveAttribute(
    "href",
    "https://studio.youtube.com/video/e2eWatch001/edit",
  );

  // YouTube stops serving it: a recheck finds out and it's hidden from students.
  await scriptYouTube("e2eWatch001", "NOT_FOUND");
  await row.getByRole("button", { name: "Recheck" }).click();
  await expect(row).toContainText("Unavailable on YouTube (deleted or removed on YouTube)");
  await expect(page.getByRole("listitem").first()).toHaveAttribute("aria-label", "Week 2: Prayer");

  // A re-upload's link brings it back, in the same place.
  await row.getByRole("button", { name: "Replace link" }).click();
  await row.getByLabel("New YouTube link").fill("https://youtu.be/e2eWatch002");
  await row.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(row).toContainText("Published");
  await expect(row.getByRole("link", { name: "YouTube Studio" })).toHaveAttribute(
    "href",
    "https://studio.youtube.com/video/e2eWatch002/edit",
  );

  // Deleted by mistake, then restored.
  await row.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("dialog", { name: 'Delete "Week 2: Prayer"?' })
    .getByRole("button", { name: "Delete video" })
    .click();
  await expect(row).toContainText("Deleted");
  await expect(row).toContainText("Can be restored until");
  await row.getByRole("button", { name: "Restore" }).click();
  await expect(row).toContainText("Published");
});
