import { linkToken } from "./mailbox";
import { expect, test } from "./test";

const EMAIL = "e2e-registrar@glim.test";
const PASSWORD = "registrar passphrase 2026";

/**
 * TRD §14.4: the Registrar reviews the seeded schemes on a phone, gives a programme its scheme,
 * adds a probation band to an unused scheme, and is told about a gap in the letter bands.
 */
test("the Registrar manages grading schemes", async ({ page }) => {
  await page.goto(`/invite/${await linkToken(EMAIL, "invite")}`);
  await page.getByLabel("New password (at least 12 characters)").fill(PASSWORD);
  await page.getByLabel("Confirm the new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await page.getByRole("link", { name: "Grading schemes" }).click();

  const diploma = page.getByRole("listitem", { name: "GLIM Diploma", exact: true });
  await expect(diploma).toContainText("Not used yet");
  await expect(diploma.getByRole("row", { name: /^A 70–100 5 Yes$/ })).toBeVisible();
  await expect(diploma).toContainText("Distinction 4.50–5 · Credit 3–4.49 · Pass 1–2.99");
  await expect(diploma).toContainText(
    "Repeats: the best attempt counts. Good standing from CGPA 1.",
  );

  // The Diploma in Ministry gets the Diploma scheme.
  const programme = page.getByRole("form", { name: "Scheme for DMIN" });
  await programme.getByRole("combobox").selectOption({ label: "GLIM Diploma" });
  await programme.getByRole("button", { name: "Save" }).click();
  await expect(diploma).toContainText("Programmes: DMIN");

  // An unused scheme changes in place.
  const certificate = page.getByRole("listitem", { name: "GLIM Certificate", exact: true });
  await certificate.getByRole("button", { name: "Edit" }).click();
  const form = page.getByRole("form", { name: "Grading scheme" });
  await form.getByLabel("Probation from CGPA (optional)").fill("0.5");
  await form.getByRole("button", { name: "Save scheme" }).click();
  await expect(certificate).toContainText("probation from 0.50");

  // A gap between B and C is refused with a reason.
  await certificate.getByRole("button", { name: "Edit" }).click();
  await form.getByRole("group", { name: "Band B" }).getByLabel("From").fill("61");
  await form.getByRole("button", { name: "Save scheme" }).click();
  await expect(form.getByRole("alert")).toContainText("without gaps");
});
