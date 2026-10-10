import { expect, test } from "./test";
import { linkToken } from "./mailbox";
import { openTeaching } from "./nav";

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

  await openTeaching(page, "Pastoral Care", "Live");
  await expect(page.getByText("No Class Meetings are scheduled.")).toBeVisible();
  await page.getByRole("button", { name: "Schedule a Class Meeting" }).click();
  await page.getByLabel("Title").fill("Week 1: Caring for the flock");
  await page.getByLabel(/^Date/).fill(lagosDate());
  await page.getByLabel("Starts").fill("09:00");
  await page.getByLabel("Ends").fill("11:00");
  await page.getByLabel("Room").selectOption({ label: "Chapel (CHAPEL)" });
  await page.getByLabel("Google Meet link (optional)").fill("https://meet.google.com/abc-defg-hij");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();

  const card = page.getByRole("article", { name: "PAS101 Week 1: Caring for the flock" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("On campus: Chapel · Online");
  // The Meet link is never shown as text (§9.14); the Lecturer gets it when starting the class.
  await expect(card).not.toContainText("meet.google.com");

  // A Lecturer's Today lists it under Coming up (§11.7).
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { name: "Coming up" })).toBeVisible();
  await expect(
    page.getByRole("article", { name: "PAS101 Week 1: Caring for the flock" }),
  ).toBeVisible();

  // Move it, then cancel it.
  await openTeaching(page, "Pastoral Care", "Live");
  await card.getByRole("button", { name: "More actions for Week 1: Caring for the flock" }).click();
  await page.getByRole("menuitem", { name: "Reschedule" }).click();
  const move = page.getByRole("dialog", { name: "Move this class" });
  await move.getByLabel(/^New date/).fill(lagosDate(2));
  await move.getByLabel("Starts").fill("14:00");
  await move.getByLabel("Ends").fill("15:00");
  await move.getByRole("button", { name: "Move class" }).click();
  await expect(card).toContainText("14:00");
  await card.getByRole("button", { name: "More actions for Week 1: Caring for the flock" }).click();
  await page.getByRole("menuitem", { name: "Cancel class" }).click();
  const cancel = page.getByRole("dialog", { name: "Cancel this class?" });
  await cancel.getByLabel("Reason (students will see it)").fill("Lecturer unwell");
  await cancel.getByRole("button", { name: "Cancel class" }).click();
  await expect(card).toContainText("Cancelled");
});

test("a Lecturer schedules a weekly series", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await openTeaching(page, "Pastoral Care", "Live");
  await page.getByRole("button", { name: "Schedule a Class Meeting" }).click();
  await page.getByLabel(/^Title/).fill("Seminar {n}");
  await page.getByLabel(/^Date/).fill(lagosDate(3));
  await page.getByLabel("Starts").fill("17:00");
  await page.getByLabel("Ends").fill("18:00");
  await page.getByLabel("Repeat weekly").check();
  await page.getByLabel(lagosWeekday(3), { exact: true }).check();
  await page.getByLabel("Until (optional)").fill(lagosDate(10));
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page.getByRole("article", { name: "PAS101 Seminar 1" })).toBeVisible();
  await expect(page.getByRole("article", { name: "PAS101 Seminar 2" })).toBeVisible();
});

/** The Lagos date and HH:mm of an instant some minutes from now. */
function lagosClock(minutesAhead: number): { date: string; time: string } {
  const at = Date.now() + minutesAhead * 60_000;
  return {
    date: new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(at),
    time: new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Lagos",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(at),
  };
}

test("a Lecturer starts a class with the room instructions, then ends it", async ({ page }) => {
  const start = lagosClock(20);
  const end = lagosClock(50);
  test.skip(start.date !== end.date, "the class would cross midnight in Lagos");
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await openTeaching(page, "Pastoral Care", "Live");
  await page.getByRole("button", { name: "Schedule a Class Meeting" }).click();
  await page.getByLabel("Title").fill("Starting soon");
  await page.getByLabel(/^Date/).fill(start.date);
  await page.getByLabel("Starts").fill(start.time);
  await page.getByLabel("Ends").fill(end.time);
  await page.getByLabel("Google Meet link (optional)").fill("https://meet.google.com/xyz-abcd-efg");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();

  const card = page.getByRole("article", { name: "PAS101 Starting soon" });
  await card.getByRole("button", { name: "Start class" }).click();
  await expect(card.getByText("The class has started.")).toBeVisible();
  await expect(card.getByText(/Open this on the room computer, signed in as you/)).toBeVisible();
  await expect(card.getByText(/Class Meetings are recorded/)).toBeVisible();
  await expect(card.getByRole("link", { name: "Open Google Meet" })).toHaveAttribute(
    "href",
    "https://meet.google.com/xyz-abcd-efg",
  );
  await card.getByRole("button", { name: "End class" }).click();
  // An ended class moves to Earlier.
  await expect(page.getByRole("listitem", { name: "Starting soon" })).toContainText("Ended");
});

test("a Lecturer adds a YouTube recording to the course", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await openTeaching(page, "Pastoral Care", "Recordings");
  await expect(page.getByText("No recordings yet")).toBeVisible();

  const link = page.getByLabel(/^YouTube link/);
  await link.fill("https://vimeo.com/12345");
  await page.getByRole("button", { name: "Add recording" }).click();
  await expect(page.getByText(/Paste the link of a YouTube video/).first()).toBeVisible();

  await link.fill("https://youtu.be/e2eRecord01");
  await page
    .getByLabel(/^Title/)
    .last()
    .fill("Week 1: Caring for the flock");
  await page.getByRole("button", { name: "Add recording" }).click();
  const recording = page.getByRole("listitem", { name: "Week 1: Caring for the flock" });
  await expect(recording).toContainText("Published");
  await recording.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(recording).toContainText("Hidden");
});
