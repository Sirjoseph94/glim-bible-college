import { expect, test, type Page } from "./test";
import { openArea, openTeaching, signOut } from "./nav";

const LECTURER = { email: "e2e-lecturer@glim.test", password: "lecturer passphrase 2026" };
const STUDENT = { email: "e2e-student2@glim.test", password: "student passphrase 2026" };
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
 * TRD §14.5, ADR-0005: after the term-results spec reopened Bola's result, the Lecturer finalizes
 * it again; the Registrar approves the cohort's results on a phone; Bola's CGPA is no longer
 * Provisional.
 */
test("the Registrar approves a cohort's results", async ({ page }) => {
  await signIn(page, LECTURER);
  await openTeaching(page, "Pastoral Care", "Gradebook");
  await page.getByRole("link", { name: "Finalize results" }).click();
  await page.getByRole("button", { name: "Finalize results" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Finalize now" }).click();
  await expect(page.getByText("2 of 2 results finalized.", { exact: false })).toBeVisible();
  await signOut(page);

  await signIn(page, STUDENT);
  await openArea(page, "Results");
  await expect(page.getByText("Provisional", { exact: true })).toBeVisible();
  await signOut(page);

  await signIn(page, REGISTRAR);
  await openArea(page, "Results");
  await page.getByRole("link", { name: "Cohort results", exact: true }).click();
  await page
    .getByLabel("Cohort")
    .selectOption({ label: "DMIN-2026-E2E · Diploma in Ministry, 2026-E2E intake" });
  const bola = page.getByRole("row", { name: /Bola Online/ });
  await expect(bola).toContainText("Provisional");
  // §11.10: the course is ready; approving asks first, saying what it does.
  await expect(page.getByText("1 course has results to approve")).toBeVisible();
  const course = page.getByRole("table", { name: "Courses" }).getByRole("row", { name: /PAS101/ });
  await expect(course).toContainText("2 of 2");
  await expect(course).toContainText("Ready to approve");
  await page.getByRole("button", { name: "Approve all" }).click();
  const approve = page.getByRole("dialog", { name: "Approve DMIN-2026-E2E's results?" });
  await expect(approve).toContainText("Finalized results become official");
  await approve.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved 2 results. Students have been told.")).toBeVisible();
  await expect(course).toContainText("Approved");
  await expect(bola).not.toContainText("Provisional");
  await expect(page.getByRole("link", { name: "Broadsheet (CSV)" })).toHaveAttribute(
    "href",
    /\/api\/v1\/reports\/results\?cohortId=.+&format=csv$/,
  );
  await signOut(page);

  await signIn(page, STUDENT);
  await openArea(page, "Results");
  const gpa = page.getByRole("region", { name: "Grade point average" });
  await expect(gpa).toContainText(/CGPA\d\.\d\d/);
  await expect(gpa).toContainText("Approved");
  await expect(page.getByText(/provisional/i)).toHaveCount(0);
});
