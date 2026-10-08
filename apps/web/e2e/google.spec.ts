import { expect, test } from "./test";
import { linkToken, nextGoogleSignIn } from "./mailbox";

const EMAIL = "e2e-google@glim.test";
const PASSWORD = "gloria's long passphrase";

test("a staff member links Google on their profile, then signs in with it", async ({ page }) => {
  await page.goto(`/invite/${await linkToken(EMAIL, "invite")}`);
  await page.getByLabel("New password (at least 12 characters)").fill(PASSWORD);
  await page.getByLabel("Confirm the new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Gloria Google" })).toBeVisible();

  await page.getByRole("link", { name: "Profile" }).click();
  await nextGoogleSignIn({
    sub: "e2e-google-sub",
    email: "gloria.personal@gmail.com",
    name: "Gloria",
  });
  await page.getByRole("link", { name: "Link Google account" }).click();
  await expect(page.getByText("Your Google account is now linked.")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await nextGoogleSignIn({ sub: "e2e-google-sub", email: "gloria.personal@gmail.com" });
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Gloria Google" })).toBeVisible();
});

test("an unknown Google account is told there's no GLIM account", async ({ page }) => {
  await page.goto("/login");
  await nextGoogleSignIn({ sub: "nobody-sub", email: "nobody@gmail.com" });
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "There's no GLIM account for that Google account",
  );
});
