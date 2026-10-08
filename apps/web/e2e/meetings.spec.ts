import { expect, test } from "@playwright/test";
import { linkToken } from "./mailbox";

const EMAIL = "e2e-lecturer@glim.test";
const PASSWORD = "lecturer passphrase 2026";

/** Tomorrow's date in Lagos, so the meeting falls inside the two-week schedule. */
function tomorrowInLagos(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(
    Date.now() + 86_400_000,
  );
}

test("a Lecturer schedules a Class Meeting in a Room and sees it on their schedule", async ({
  page,
}) => {
  await page.goto(`/invite/${await linkToken(EMAIL, "invite")}`);
  await page.getByLabel("New password (at least 12 characters)").fill(PASSWORD);
  await page.getByLabel("Confirm the new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page.getByRole("heading", { name: /^Welcome/ })).toBeVisible();

  await page.getByRole("link", { name: "My offerings" }).click();
  await expect(page.getByText("No Class Meetings in the next two weeks.")).toBeVisible();
  await page.getByRole("button", { name: "Schedule a Class Meeting" }).click();
  await page.getByLabel("Title").fill("Week 1: Caring for the flock");
  await page.getByLabel(/^Date/).fill(tomorrowInLagos());
  await page.getByLabel("Starts").fill("09:00");
  await page.getByLabel("Ends").fill("11:00");
  await page.getByLabel("Room").selectOption({ label: "Chapel (CHAPEL)" });
  await page.getByLabel("Google Meet link (optional)").fill("https://meet.google.com/abc-defg-hij");
  await page.getByRole("button", { name: "Schedule" }).click();

  const card = page.getByRole("listitem").filter({ hasText: "Week 1: Caring for the flock" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("In Chapel (CHAPEL) and online");
  await expect(card.getByRole("link", { name: "Online link" })).toHaveAttribute(
    "href",
    "https://meet.google.com/abc-defg-hij",
  );

  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByText("Your Class Meetings in the next two weeks")).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "PAS101 · Week 1: Caring for the flock" }),
  ).toBeVisible();
});
