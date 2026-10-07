import { expect, test } from "@playwright/test";
import { linkToken } from "./mailbox";

const ADMIN = "e2e-admin@glim.test";
const PASSWORD = "a long and happy passphrase 2026";
const NEW_PASSWORD = "another long passphrase for 2027";

test("an invited System Admin sets a password, signs out, signs in, and resets the password", async ({
  page,
}) => {
  await page.goto(`/invite/${await linkToken(ADMIN, "invite")}`);
  await expect(page.getByTestId("institution-name")).not.toBeEmpty();
  await page.getByLabel("New password (at least 12 characters)").fill(PASSWORD);
  await page.getByLabel("Confirm the new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Esther Admin" })).toBeVisible();
  await expect(page.getByText("Signed in as system admin.")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByLabel("Email").fill(ADMIN);
  await page.getByLabel("Password").fill("not the right password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("The email or password is incorrect");

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Esther Admin" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await page.getByLabel("Email").fill(ADMIN);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toContainText("we've sent a link");

  await page.goto(`/reset/${await linkToken(ADMIN, "reset")}`);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await page.getByLabel("New password (at least 12 characters)").fill(NEW_PASSWORD);
  await page.getByLabel("Confirm the new password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("status")).toContainText("Your password has been changed");

  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(ADMIN);
  await page.getByLabel("Password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Esther Admin" })).toBeVisible();
});

test("a signed-out visitor to / is sent to sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
