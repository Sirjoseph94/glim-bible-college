import { expect, test } from "@playwright/test";
import { linkToken } from "./mailbox";

const EMAIL = "e2e-rollcall@glim.test";
const PASSWORD = "roll call passphrase 2026";

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

test("a Lecturer takes roll call on a phone, through a dropped connection", async ({
  page,
  context,
}) => {
  // Roll call opens 15 minutes before the start. Short, so it ends before the meetings spec's
  // class on the same offering (20 minutes from now) begins.
  const start = lagosClock(6);
  const end = lagosClock(14);
  test.skip(start.date !== end.date, "the class would cross midnight in Lagos");

  await page.goto(`/invite/${await linkToken(EMAIL, "invite")}`);
  await page.getByLabel("New password (at least 12 characters)").fill(PASSWORD);
  await page.getByLabel("Confirm the new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await page.getByRole("link", { name: "My offerings" }).click();
  await page.getByRole("button", { name: "Schedule a Class Meeting" }).click();
  await page.getByLabel("Title").fill("Roll call practice");
  await page.getByLabel(/^Date/).fill(start.date);
  await page.getByLabel("Starts").fill(start.time);
  await page.getByLabel("Ends").fill(end.time);
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Roll call practice" })
    .getByRole("link", { name: "Roll call" })
    .click();

  // On-campus students come first.
  await expect(page.getByRole("heading", { name: "Roll call" })).toBeVisible();
  const names = page.getByRole("listitem").locator("div.font-medium");
  await expect(names).toHaveText(["Ada Campus", "Bola Online"]);

  await page.getByRole("button", { name: "Mark all on-campus present" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  const ada = page.getByRole("group", { name: "Mark Ada Campus" });
  await expect(ada.getByRole("button", { name: "In room" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The Wi-Fi drops: the mark is kept and retried.
  await context.setOffline(true);
  const bola = page.getByRole("group", { name: "Mark Bola Online" });
  await bola.getByRole("button", { name: "Online" }).click();
  await bola.getByLabel("Late").check();
  await expect(page.getByRole("status")).toContainText("will retry");
  await context.setOffline(false);
  await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 15_000 });

  // The marks are on the server.
  await page.reload();
  await expect(bola.getByRole("button", { name: "Online" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(bola.getByLabel("Late")).toBeChecked();

  // The worker recomputes attendance from the roll call.
  await page.goto(page.url().replace(/roll-call$/, "attendance"));
  await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: "Bola Online" })).toContainText(
      "Present online, late",
      { timeout: 1000 },
    );
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole("listitem").filter({ hasText: "Ada Campus" })).toContainText(
    "Present in the room",
  );
  await expect(page.getByText(/Provisional/)).toBeVisible();
});
