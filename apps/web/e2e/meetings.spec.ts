import { expect, test } from "@playwright/test";
import { linkToken } from "./mailbox";

const EMAIL = "e2e-lecturer@glim.test";
const PASSWORD = "lecturer passphrase 2026";

/** A date in Lagos some days from now, inside the two-week schedule. */
function lagosDate(daysAhead = 1): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(
    Date.now() + daysAhead * 86_400_000,
  );
}

/** The weekday label the form uses for that date. */
function lagosWeekday(daysAhead: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "short" }).format(
    Date.now() + daysAhead * 86_400_000,
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
  await page.getByLabel(/^Date/).fill(lagosDate());
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

  // Move it, then cancel it.
  await page.getByRole("link", { name: "My offerings" }).click();
  const mine = page.getByRole("listitem").filter({ hasText: "Week 1: Caring for the flock" });
  await mine.getByRole("button", { name: "Reschedule" }).click();
  await mine.getByLabel("New date").fill(lagosDate(2));
  await mine.getByLabel("Starts").fill("14:00");
  await mine.getByLabel("Ends").fill("15:00");
  await mine.getByRole("button", { name: "Move class" }).click();
  await expect(mine).toContainText("14:00");
  await mine.getByRole("button", { name: "Cancel class" }).click();
  await mine.getByLabel("Reason (students will see it)").fill("Lecturer unwell");
  await mine.getByRole("button", { name: "Cancel class" }).click();
  await expect(mine).toContainText("Cancelled");
});

test("a Lecturer schedules a weekly series", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "My offerings" }).click();
  await page.getByRole("button", { name: "Schedule a Class Meeting" }).click();
  await page.getByLabel(/^Title/).fill("Seminar {n}");
  await page.getByLabel(/^Date/).fill(lagosDate(3));
  await page.getByLabel("Starts").fill("17:00");
  await page.getByLabel("Ends").fill("18:00");
  await page.getByLabel("Repeat weekly").check();
  await page.getByLabel(lagosWeekday(3), { exact: true }).check();
  await page.getByLabel("Until (optional)").fill(lagosDate(10));
  await page.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByText("PAS101 · Seminar 1")).toBeVisible();
  await expect(page.getByText("PAS101 · Seminar 2")).toBeVisible();
});
