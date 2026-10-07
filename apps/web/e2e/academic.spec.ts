import { expect, test } from "@playwright/test";
import { linkToken } from "./mailbox";

const EMAIL = "e2e-academic@glim.test";
const PASSWORD = "academic passphrase 2026";

test("the Academic Admin sets up a programme, courses and an active curriculum", async ({
  page,
}) => {
  await page.goto(`/invite/${await linkToken(EMAIL, "invite")}`);
  await page.getByLabel("New password (at least 12 characters)").fill(PASSWORD);
  await page.getByLabel("Confirm the new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Ade Academic" })).toBeVisible();

  await page.getByRole("link", { name: "Academic" }).click();
  await page.getByText("Add a programme").click();
  await page.getByLabel("Code (e.g. DIP)").fill("CERT");
  await page.getByLabel("Name").fill("Certificate in Theology");
  await page.getByRole("button", { name: "Add programme" }).click();
  await expect(page.getByText("CERT · Certificate in Theology")).toBeVisible();

  await page.getByText("Add a course").click();
  for (const [code, title, credits] of [
    ["BIB101", "Old Testament Survey", "3"],
    ["MIN101", "Introduction to Ministry", "2"],
  ] as const) {
    await page.getByLabel("Code", { exact: true }).fill(code);
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Credits").fill(credits);
    await page.getByRole("button", { name: "Add course" }).click();
    await expect(page.getByText(`${code} ${title}`)).toBeVisible();
  }

  await page.getByRole("button", { name: "New curriculum version" }).click();
  await expect(page.getByRole("heading", { name: /Curriculum v1/ })).toBeVisible();
  await page.getByRole("button", { name: "Add a course" }).click();
  await page.getByRole("button", { name: "Add a course" }).click();
  await page.getByLabel("Course 2").selectOption({ label: "MIN101 Introduction to Ministry" });
  await page.getByLabel("Type 2").selectOption("ELECTIVE");
  await page.getByRole("button", { name: "Save placements" }).click();
  await page.getByRole("button", { name: "Activate" }).click();
  await expect(page.getByRole("heading", { name: /Curriculum v1 · active/ })).toBeVisible();
});
