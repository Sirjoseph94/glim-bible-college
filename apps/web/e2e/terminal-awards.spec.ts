import { expect, test, type Page } from "./test";
import { openArea } from "./nav";

/** Set in the grading-schemes spec. */
const REGISTRAR = { email: "e2e-registrar@glim.test", password: "registrar passphrase 2026" };

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^Welcome/ })).toBeVisible();
}

/**
 * TRD §14.6: runs after the term specs published Bola's semester. The Registrar proposes Bola's
 * award on a phone, sees every requirement met, and confers it with a certificate number.
 */
test("the Registrar proposes and confers an award", async ({ page }) => {
  await signIn(page, REGISTRAR);
  await openArea(page, "Results");
  await page.getByRole("link", { name: "Awards" }).click();
  const bola = page
    .getByRole("region", { name: "Students" })
    .getByRole("row", { name: /^Bola Online / });
  await expect(bola).toHaveAccessibleName(/^Bola Online GLIM\/DIP\/2032\/0002 DMIN /);
  await bola.getByRole("button", { name: "Propose award" }).click();

  const proposal = page.getByRole("region", { name: "Award proposal" });
  await expect(proposal).toContainText("Bola Online · Diploma in Ministry");
  const requirements = proposal.getByRole("list", { name: "Requirements" });
  await expect(
    requirements.getByRole("listitem").filter({ hasText: "Every compulsory course passed" }),
  ).toContainText(/Met$/);
  await expect(
    requirements.getByRole("listitem").filter({ hasText: "Every semester's results published" }),
  ).toContainText(/Met$/);
  await expect(requirements).not.toContainText("Not met");
  // Conferring is consequential: a dialog names the student before it goes ahead.
  await proposal.getByRole("button", { name: /^Confer / }).click();
  const confirm = page.getByRole("dialog", {
    name: /^Confer the Diploma in Ministry on Bola Online/,
  });
  await expect(confirm).toContainText("GLIM/DIP/2032/0002");
  await confirm.getByRole("button", { name: "Confer award" }).click();
  await expect(proposal.getByRole("status")).toContainText(
    /certificate GLIM\/DIP\/AWD\/\d{4}\/0001/,
  );
  await expect(
    page.getByRole("region", { name: "Students" }).getByRole("row", { name: /^Bola Online / }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Conferred awards" })
      .getByRole("row", { name: /^Bola Online DMIN \w+ \d\.\d\d GLIM\/DIP\/AWD/ }),
  ).toBeVisible();
});
