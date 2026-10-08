import { expect, test } from "@playwright/test";
import { linkToken } from "./mailbox";

const EMAIL = "e2e-imports@glim.test";
const PASSWORD = "imports passphrase 2026";

test("the Academic Admin checks a Lecturers CSV, then imports it", async ({ page }) => {
  await page.goto(`/invite/${await linkToken(EMAIL, "invite")}`);
  await page.getByLabel("New password (at least 12 characters)").fill(PASSWORD);
  await page.getByLabel("Confirm the new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Ike Imports" })).toBeVisible();

  await page.getByRole("link", { name: "Imports" }).click();
  await page.getByLabel("What are you importing?").selectOption("LECTURERS");
  await page.getByLabel("CSV file").setInputFiles({
    name: "lecturers.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "email,title,given_name,family_name,kind,staff_code",
        "imported.one@glim.test,Rev,Imported,One,INTERNAL,IMP-1",
        "imported.two@glim.test,,Imported,Two,GUEST,",
        "not-an-email,,Bad,Row,INTERNAL,",
      ].join("\r\n"),
    ),
  });
  await expect(
    page.getByText("Checked 3 rows: 2 valid, 1 with errors.", { exact: false }),
  ).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("link", { name: "Download the rows with errors" })).toBeVisible();
  await page.getByRole("button", { name: "Import 2 valid rows" }).click();
  await expect(page.getByText("Imported 3 rows: 2 valid", { exact: false })).toBeVisible({
    timeout: 15_000,
  });
});
