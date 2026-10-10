import { expect, test } from "./test";
import { linkToken } from "./mailbox";
import { openTeaching } from "./nav";

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
  await openTeaching(page, "Pastoral Care", "Live");
  await page.getByRole("button", { name: "Schedule a Class Meeting" }).click();
  await page.getByLabel("Title").fill("Roll call practice");
  await page.getByLabel(/^Date/).fill(start.date);
  await page.getByLabel("Starts").fill(start.time);
  await page.getByLabel("Ends").fill(end.time);
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await page
    .getByRole("article", { name: "PAS101 Roll call practice" })
    .getByRole("link", { name: "Roll call" })
    .click();

  // On-campus students come first.
  await expect(page.getByRole("heading", { name: "Roll call" })).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveText([/^Ada Campus/, /^Bola Online/]);

  await page.getByRole("button", { name: "Mark all on-campus present" }).click();
  await expect(page.getByRole("status", { name: "Marks" })).toHaveText("Saved");
  const ada = page.getByRole("group", { name: "Mark Ada Campus" });
  await expect(ada.getByRole("button", { name: "In room" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The Wi-Fi drops: the marks wait on the phone (§9.20) and go when it's back.
  await context.setOffline(true);
  const bola = page.getByRole("group", { name: "Mark Bola Online" });
  await bola.getByRole("button", { name: "Online" }).click();
  await bola.getByLabel("Late").check();
  await expect(page.getByRole("status", { name: "Marks" })).toHaveText("1 mark waiting to send");
  await expect(page.getByText("You are offline")).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole("status", { name: "Marks" })).toHaveText("Saved", {
    timeout: 40_000,
  });

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
  const bolaRow = page.getByRole("listitem", { name: "Bola Online" });
  await expect(async () => {
    await page.reload();
    await expect(bolaRow).toContainText("Online · late", { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(bolaRow).toContainText("Present");
  const adaRow = page.getByRole("listitem", { name: "Ada Campus" });
  await expect(adaRow).toContainText("In the room");
  await expect(adaRow).toContainText("Present");
  await expect(page.getByRole("list", { name: "Summary" })).toContainText("2 Present");
  await expect(page.getByText(/Provisional/)).toBeVisible();

  // Excuse Ada with a reason; the change shows on the record.
  await adaRow.getByRole("button", { name: "Change attendance for Ada Campus" }).click();
  const sheet = page.getByRole("dialog", { name: "Change attendance for Ada Campus" });
  await sheet.getByRole("radio", { name: "Excused" }).check();
  await sheet.getByLabel("Reason").fill("Ill");
  await sheet.getByRole("button", { name: "Save change" }).click();
  await expect(sheet.getByText("Write at least 5 characters.")).toBeVisible();
  await sheet.getByLabel("Reason").fill("Hospital appointment");
  await sheet.getByRole("button", { name: "Save change" }).click();
  await expect(adaRow).toContainText("Excused");
  await expect(adaRow).toContainText("Edited");
  await expect(page.getByRole("list", { name: "Summary" })).toContainText("1 Excused");
});
