import { expect, test } from "@playwright/test";
import { linkToken } from "./mailbox";

const EMAIL = "e2e-admissions@glim.test";
const PASSWORD = "admissions passphrase 2026";

test("an Admissions Officer plans, opens and closes the intake, and applicants see each state on /apply", async ({
  browser,
  page,
}) => {
  await page.goto(`/invite/${await linkToken(EMAIL, "invite")}`);
  await page.getByLabel("New password (at least 12 characters)").fill(PASSWORD);
  await page.getByLabel("Confirm the new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Amaka Admissions" })).toBeVisible();

  await page.getByRole("link", { name: "Admissions" }).click();
  await page.getByLabel("Intake (year students start, e.g. 2027)").fill("2030");
  await page
    .getByLabel("Academic Session students start in")
    .selectOption({ label: "2030/2031 Session" });
  await page.getByLabel("Applications open (November)").fill("2029-11-01");
  await page.getByLabel("Applications close (June)").fill("2030-06-30");
  await page.getByRole("button", { name: "Plan intake" }).click();
  await expect(page.getByText("Intake 2030 · 2030/2031 Session")).toBeVisible();
  await page.getByRole("button", { name: "Open now" }).click();
  await expect(page.getByText("open", { exact: true })).toBeVisible();

  // An applicant, in a browser of their own without the officer's session.
  const applicant = await (
    await browser.newContext({ baseURL: new URL(page.url()).origin })
  ).newPage();
  await applicant.goto("/apply");
  await expect(
    applicant.getByText("Applications for the 2030/2031 Session are open until"),
  ).toBeVisible();
  await expect(applicant.getByText("Sun, 30 Jun 2030")).toBeVisible();
  await expect(applicant.getByRole("link", { name: "Create one free" })).toBeVisible();

  await page.getByRole("button", { name: "Close now" }).click();
  await expect(page.getByText("closed", { exact: true })).toBeVisible();
  await applicant.reload();
  await expect(
    applicant.getByText("Applications for the 2030/2031 Session are closed."),
  ).toBeVisible();
});
