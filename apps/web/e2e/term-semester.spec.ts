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
 * TRD §14.5: after the term-results spec reopened Bola's result, the Lecturer finalizes it again;
 * the Registrar computes, approves and publishes the semester on a phone; Bola's GPA and CGPA are
 * no longer Provisional.
 */
test("the Registrar computes, approves and publishes semester results", async ({ page }) => {
  await signIn(page, LECTURER);
  await openTeaching(page, "Pastoral Care", "Gradebook");
  await page.getByRole("link", { name: "Finalize results" }).click();
  await page.getByRole("button", { name: "Finalize results" }).click();
  await page.getByRole("button", { name: "Finalize now" }).click();
  await expect(page.getByText("2 of 2 results finalized.", { exact: false })).toBeVisible();
  await signOut(page);

  await signIn(page, STUDENT);
  await openArea(page, "Results");
  await expect(page.getByText("Provisional", { exact: true })).toBeVisible();
  await signOut(page);

  await signIn(page, REGISTRAR);
  await openArea(page, "Results");
  await page.getByRole("link", { name: "Semester results" }).click();
  await page.getByLabel("Semester").selectOption({ label: "First Semester, 2032/2033" });
  await page.getByRole("button", { name: "Compute" }).click();
  await expect(page.getByText("Computed 2; 2 changed.")).toBeVisible();
  const bola = page.getByRole("row", { name: /Bola Online/ });
  await expect(bola).toContainText("Draft");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved 2.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published 2. Students have been told.")).toBeVisible();
  await expect(bola).toContainText("Published");
  await expect(page.getByRole("link", { name: "Broadsheet (CSV)" })).toHaveAttribute(
    "href",
    /\/api\/v1\/reports\/results\?semesterId=.+&format=csv$/,
  );
  await signOut(page);

  await signIn(page, STUDENT);
  await openArea(page, "Results");
  const gpa = page.getByRole("region", { name: "Grade point average" });
  await expect(gpa).toContainText(/This semester\d\.\d\dCGPA\d\.\d\d/);
  await expect(gpa).toContainText("Approved");
  await expect(page.getByText(/provisional/i)).toHaveCount(0);
});
