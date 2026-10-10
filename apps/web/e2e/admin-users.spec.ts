import { expect, test } from "./test";
import { linkToken } from "./mailbox";
import { openArea } from "./nav";

const OPS = "e2e-ops@glim.test";
const PASSWORD = "operations passphrase 2026";

test("a System Admin invites a registrar, grants a role, and sees it in the audit log", async ({
  page,
}) => {
  await page.goto(`/invite/${await linkToken(OPS, "invite")}`);
  await page.getByLabel("New password (at least 12 characters)").fill(PASSWORD);
  await page.getByLabel("Confirm the new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Obi Ops" })).toBeVisible();

  await openArea(page, "People");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await page.getByRole("button", { name: "Invite a staff member" }).click();
  const invite = page.getByRole("dialog", { name: "Invite a staff member" });
  await invite.getByLabel("Full name", { exact: true }).fill("Rita Registrar");
  await invite.getByLabel("Email", { exact: true }).fill("rita@glim.test");
  await invite.getByLabel("Registrar", { exact: true }).check();
  await invite.getByRole("button", { name: "Send invite" }).click();
  await expect(invite).toBeHidden();
  await expect(page.getByRole("status")).toHaveText("Invite emailed to rita@glim.test.");

  await page.getByRole("link", { name: "Rita Registrar" }).click();
  await expect(page.getByRole("heading", { name: "Rita Registrar" })).toBeVisible();
  await expect(page.getByText("Registrar since")).toBeVisible();

  await page.getByLabel("Role to grant").selectOption("ADMISSIONS_OFFICER");
  await page.getByRole("button", { name: "Grant role" }).click();
  const grant = page.getByRole("dialog", { name: "Grant Admissions Officer?" });
  await grant.getByLabel("Why grant this role?").fill("Also runs admissions");
  await grant.getByRole("button", { name: "Grant Admissions Officer" }).click();
  await expect(grant).toBeHidden();
  await expect(page.getByText("Admissions Officer since")).toBeVisible();

  await openArea(page, "Settings");
  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByText("authorization.role.granted").first()).toBeVisible();
  await expect(page.getByText("Also runs admissions")).toBeVisible();
});
