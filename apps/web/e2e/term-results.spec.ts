import { expect, test, type Page } from "./test";

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

async function score(page: Page, cell: string, value: string) {
  await page.getByRole("button", { name: cell }).click();
  const edit = page.getByRole("form", { name: "Edit grade" });
  await edit.getByLabel(/Score/).fill(value);
  await edit.getByRole("button", { name: "Save grade" }).click();
  await expect(edit.getByText("Saved")).toBeVisible();
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
  await page.getByRole("link", { name: "My offerings" }).click();
  await page.getByRole("link", { name: "Gradebook" }).click();
  const note = await page.getByText(/weights add up to/).textContent();
  const total = /add up to ([\d.]+) %/.exec(note ?? "")?.[1] ?? "100";
  const remaining = (Math.round((100 - Number(total)) * 100) / 100).toFixed(2);
  await page.getByText("Columns and weights").click();
  const add = page.getByRole("form", { name: "Add a column" });
  await add.getByLabel("Title").fill("Final project");
  await add.getByLabel("Out of").fill("100");
  await add.getByLabel("Weight (%)").fill(remaining);
  await add.getByRole("button", { name: "Add column" }).click();
  await expect(page.getByText("Published columns' weights add up to 100 %.")).toBeVisible();
  await score(page, "Bola Online, Final project", "70");
  await score(page, "Ada Campus, Final project", "45");

  await page.getByRole("link", { name: "Back to teaching" }).click();
  await page.getByRole("link", { name: "Results" }).click();
  await expect(page.getByText(/Nothing is finalized yet/)).toBeVisible();
  await expect(page.getByRole("listitem", { name: "Bola Online" })).toContainText("Preview");
  await page.getByRole("button", { name: "Finalize results" }).click();
  await page.getByRole("button", { name: "Finalize now" }).click();
  await expect(
    page.getByText("2 of 2 results finalized. Students see them straight away."),
  ).toBeVisible();
  const bola = page.getByRole("listitem", { name: "Bola Online" });
  await expect(bola).toContainText("Finalized");
  const letter = /% · ([A-F])/.exec((await bola.textContent()) ?? "")?.[1];
  expect(letter).toMatch(/^[A-F]$/);
  await page.getByRole("button", { name: "Sign out" }).click();

  await signIn(page, STUDENT);
  await page.getByRole("link", { name: "My results" }).click();
  const semester = page.locator('[aria-label*="2032/2033"]');
  await expect(semester).toContainText("Provisional");
  await expect(semester).toContainText("PAS101 Pastoral Care");
  await expect(semester.locator("strong")).toHaveText(letter ?? "");
  await expect(semester).toContainText(/GPA \d\.\d\d · CGPA \d\.\d\d/);
  await page.getByRole("button", { name: "Sign out" }).click();

  await signIn(page, REGISTRAR);
  await page.getByRole("link", { name: "Course results" }).click();
  await page.getByRole("link", { name: "PAS101 Pastoral Care" }).click();
  const row = page.getByRole("listitem", { name: "Bola Online" });
  await row.getByRole("button", { name: "Reopen" }).click();
  await row.getByLabel("Reason").fill("Final project re-marked");
  await row.getByRole("button", { name: "Reopen" }).click();
  await expect(row).toContainText("Reopened: finalize again to record it");
  await expect(page.getByText("1 of 2 results finalized.", { exact: false })).toBeVisible();
});
