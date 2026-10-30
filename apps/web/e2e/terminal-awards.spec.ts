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
 * TRD §14.6, ADR-0005: runs after the term specs approved Bola's results. Bola has passed the
 * whole DMIN curriculum (PAS101), so the Registrar confers the Certificate on a phone, which leaves
 * Bola a student, then the Diploma, which graduates them.
 */
test("the Registrar confers the Certificate, then the Diploma", async ({ page }) => {
  await signIn(page, REGISTRAR);
  await openArea(page, "Results");
  await page.getByRole("link", { name: "Awards", exact: true }).click();
  const bola = page
    .getByRole("region", { name: "Students" })
    .getByRole("row", { name: /^Bola Online / });
  await expect(bola).toHaveAccessibleName(/^Bola Online GLIM\/DIP\/2032\/0002 DMIN-2026-E2E /);
  await expect(bola).toContainText("3 of 3");

  await bola.getByRole("button", { name: "Propose Certificate" }).click();
  const proposal = page.getByRole("region", { name: "Award proposal" });
  await expect(proposal).toContainText("Bola Online · Certificate");
  const requirements = proposal.getByRole("list", { name: "Requirements" });
  await expect(
    requirements
      .getByRole("listitem")
      .filter({ hasText: "Courses worth half the curriculum's credits passed" }),
  ).toContainText(/Met$/);
  await expect(
    requirements.getByRole("listitem").filter({ hasText: "Every result approved by the Registrar" }),
  ).toContainText(/Met$/);
  await expect(requirements).not.toContainText("Not met");
  // Conferring is consequential: a dialog names the student before it goes ahead.
  await proposal.getByRole("button", { name: /^Confer / }).click();
  const certificate = page.getByRole("dialog", { name: "Confer the Certificate on Bola Online?" });
  await expect(certificate).toContainText("carries on towards the Diploma");
  await certificate.getByRole("button", { name: "Confer award" }).click();
  await expect(proposal.getByRole("status")).toContainText(
    /certificate GLIM\/CERT\/AWD\/\d{4}\/0001/,
  );
  // Still a student: the Diploma is next.
  await expect(bola).toContainText("Certificate: Conferred");

  await bola.getByRole("button", { name: "Propose Diploma" }).click();
  await expect(proposal).toContainText("Bola Online · Diploma");
  await expect(
    requirements.getByRole("listitem").filter({ hasText: "Every curriculum course passed" }),
  ).toContainText(/Met$/);
  await proposal.getByRole("button", { name: /^Confer / }).click();
  const diploma = page.getByRole("dialog", { name: "Confer the Diploma on Bola Online?" });
  await expect(diploma).toContainText("GLIM/DIP/2032/0002");
  await diploma.getByRole("button", { name: "Confer award" }).click();
  await expect(proposal.getByRole("status")).toContainText(
    /certificate GLIM\/DIP\/AWD\/\d{4}\/0001/,
  );
  await expect(
    page.getByRole("region", { name: "Students" }).getByRole("row", { name: /^Bola Online / }),
  ).toHaveCount(0);
  const conferred = page.getByRole("region", { name: "Conferred awards" });
  await expect(
    conferred.getByRole("row", { name: /^Bola Online Certificate \w+ \d\.\d\d GLIM\/CERT\/AWD/ }),
  ).toBeVisible();
  await expect(
    conferred.getByRole("row", { name: /^Bola Online Diploma \w+ \d\.\d\d GLIM\/DIP\/AWD/ }),
  ).toBeVisible();
});
