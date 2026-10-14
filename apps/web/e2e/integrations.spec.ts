import { linkToken } from "./mailbox";
import { openArea } from "./nav";
import { expect, test } from "./test";

const EMAIL = "e2e-integrations@glim.test";
const PASSWORD = "integrations passphrase 2026";

/**
 * TRD §15.3, Appendix A (integration slice): with Google Meet off, the System Admin sees how to
 * switch it on and adds a host account; then connects GLIM's YouTube channel through Google's
 * consent (stood in for here) and disconnects it again.
 */
test("the System Admin sets up host accounts and connects the YouTube channel", async ({
  page,
}) => {
  await page.goto(`/invite/${await linkToken(EMAIL, "invite")}`);
  await page.getByLabel("New password (at least 12 characters)").fill(PASSWORD);
  await page.getByLabel("Confirm the new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await openArea(page, "Ops");
  await page.getByRole("link", { name: "Integrations" }).click();

  const google = page.getByRole("region", { name: "Google Meet" });
  await expect(google).toContainText("Off: Lecturers paste Meet links");
  await expect(google.getByRole("button", { name: "Test Google" })).toBeDisabled();
  await google.getByLabel("Add a host account").fill("lms-host-01@glim.test");
  await google.getByRole("button", { name: "Add", exact: true }).click();
  await expect(google.getByRole("row", { name: "lms-host-01@glim.test" })).toContainText(
    "Not subscribed",
  );

  // Google's consent screen: the app's own redirect to it is answered by sending the browser
  // straight back with a code, as Google does after a "yes" (Playwright can't route redirects).
  await page.route("**/api/v1/admin/integrations/youtube/connect", async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const consent = new URL(response.headers().location ?? "");
    expect(consent.hostname).toBe("accounts.google.test");
    const back = new URL(consent.searchParams.get("redirect_uri") ?? "");
    back.searchParams.set("code", "good-code");
    back.searchParams.set("state", consent.searchParams.get("state") ?? "");
    await route.fulfill({
      response,
      headers: { ...response.headers(), location: back.toString() },
    });
  });
  const youtube = page.getByRole("region", { name: "YouTube channel" });
  await youtube.getByRole("link", { name: "Connect the channel" }).click();
  await expect(page.getByText("The YouTube channel is connected.")).toBeVisible();
  await expect(youtube).toContainText("GLIM Online Bible College");
  await youtube.getByRole("button", { name: "Disconnect" }).click();
  await expect(youtube.getByRole("link", { name: "Connect the channel" })).toBeVisible();
});
