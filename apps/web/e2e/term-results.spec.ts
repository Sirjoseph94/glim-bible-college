import { expect, test, type Page } from "./test";
import { openArea, openTeaching, signOut } from "./nav";

const LECTURER = { email: "e2e-lecturer@glim.test", password: "lecturer passphrase 2026" };
const STUDENT = { email: "e2e-student2@glim.test", password: "student passphrase 2026" };
/** The Registrar set this password in the grading-schemes spec. */
const REGISTRAR = { email: "e2e-registrar@glim.test", password: "registrar passphrase 2026" };

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^Welcome/ })).toBeVisible();
}

/**
 * Types a score in its gradebook cell (§9.19) and waits for the save. Enter moves the editor down
 * a row, so the cell may already be open.
 */
async function score(page: Page, cell: string, value: string) {
  const input = page.getByLabel(`Score for ${cell}`);
  if (!(await input.isVisible())) await page.getByRole("button", { name: cell }).click();
  await input.fill(value);
  await input.press("Enter");
  await expect(page.getByRole("button", { name: cell })).toContainText(value);
}

/**
 * TRD §14.3, C-11: runs after the teaching specs, whose columns fill this gradebook. The PRIMARY
 * Lecturer balances the weights to 100, finalizes on a phone, the student sees the result marked
 * Provisional, and the Registrar reopens it with a reason.
 */
test("a Lecturer finalizes results, the student sees them, the Registrar reopens one", async ({
  page,
}) => {
  await signIn(page, LECTURER);
  await openTeaching(page, "Pastoral Care", "Gradebook");
  const note = await page
    .getByText(/add up to [\d.]+% now|weights add up to 100%/)
    .first()
    .textContent();
  const total = /add up to ([\d.]+)%/.exec(note ?? "")?.[1] ?? "100";
  const remaining = (Math.round((100 - Number(total)) * 100) / 100).toFixed(2);
  await page.getByRole("button", { name: "Columns and weights" }).click();
  const add = page.getByRole("form", { name: "Add a column" });
  await add.getByLabel("Title").fill("Final project");
  await add.getByLabel("Out of").fill("100");
  await add.getByLabel("Weight (%)").fill(remaining);
  await add.getByRole("button", { name: "Add column" }).click();
  await expect(page.getByText("Published columns' weights add up to 100%.")).toBeVisible();
  await score(page, "Bola Online, Final project", "70");
  await score(page, "Ada Campus, Final project", "45");

  await page.getByRole("link", { name: "Finalize results" }).click();
  await expect(page.getByText(/Nothing is finalized yet/)).toBeVisible();
  await expect(page.getByRole("row", { name: /Bola Online/ })).toContainText("Preview");
  await page.getByRole("button", { name: "Finalize results" }).click();
  await page
    .getByRole("dialog", { name: "Finalize 2 results?" })
    .getByRole("button", { name: "Finalize now" })
    .click();
  await expect(
    page.getByText("2 of 2 results finalized. Students see them straight away."),
  ).toBeVisible();
  const bola = page.getByRole("row", { name: /Bola Online/ });
  await expect(bola).toContainText("Finalized");
  // Cells: Final %, then the letter grade.
  const letter = /^([A-F])/.exec((await bola.getByRole("cell").nth(1).textContent()) ?? "")?.[1];
  expect(letter).toMatch(/^[A-F]$/);
  await signOut(page);

  await signIn(page, STUDENT);
  await openArea(page, "Results");
  const gpa = page.getByRole("region", { name: "Grade point average" });
  await expect(gpa).toContainText("Provisional");
  await expect(gpa).toContainText(/CGPA\d\.\d\d/);
  const courses = page.getByRole("region", { name: "Course results" });
  await expect(courses).toContainText("PAS101");
  await expect(courses).toContainText("Pastoral Care");
  await expect(courses.locator("strong")).toHaveText(letter ?? "");
  await signOut(page);

  await signIn(page, REGISTRAR);
  await openArea(page, "Results");
  await page.getByRole("link", { name: "Course results", exact: true }).click();
  // The teaching cohort's offering; the academic spec planned another of PAS101.
  await page.getByRole("link", { name: /PAS101 Pastoral Care\s*DMIN-2026-E2E/ }).click();
  const row = page.getByRole("row", { name: /Bola Online/ });
  await row.getByRole("button", { name: "Reopen Bola Online's result" }).click();
  const reopen = page.getByRole("dialog", { name: "Reopen Bola Online's result?" });
  await reopen.getByLabel("Reason").fill("Final project re-marked");
  await reopen.getByRole("button", { name: "Reopen result" }).click();
  await expect(row).toContainText("Reopened");
  await expect(page.getByText("1 of 2 results finalized.", { exact: false })).toBeVisible();
});
