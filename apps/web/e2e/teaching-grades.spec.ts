import { expect, test, type Page } from "./test";

const LECTURER = { email: "e2e-lecturer@glim.test", password: "lecturer passphrase 2026" };
const STUDENT = { email: "e2e-student2@glim.test", password: "student passphrase 2026" };

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^Welcome/ })).toBeVisible();
}

async function addColumn(page: Page, title: string, maxScore: string, weight: string) {
  const form = page.getByRole("form", { name: "Add a column" });
  if (!(await form.isVisible())) await page.getByText("Columns and weights").click();
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Out of").fill(maxScore);
  await form.getByLabel("Weight (%)").fill(weight);
  await form.getByRole("button", { name: "Add column" }).click();
  await expect(page.getByRole("columnheader", { name: new RegExp(title) })).toBeVisible();
}

/**
 * TRD §14.2, AC-11: a Lecturer enters a score by hand and imports another column from CSV on a
 * phone, then releases one column; the student sees only the released grade, with its feedback.
 */
test("a Lecturer enters, imports and releases grades; the student sees only released ones", async ({
  page,
}) => {
  await signIn(page, LECTURER);
  await page.getByRole("link", { name: "My offerings" }).click();
  await page.getByRole("link", { name: "Gradebook" }).click();
  await expect(page.getByRole("heading", { name: "Gradebook" })).toBeVisible();

  await addColumn(page, "Memory verse test", "10", "5");
  await page.getByRole("button", { name: "Bola Online, Memory verse test" }).click();
  const edit = page.getByRole("form", { name: "Edit grade" });
  await edit.getByLabel(/Score/).fill("8");
  await edit.getByLabel("Feedback").fill("**Word-perfect** recital.");
  await edit.getByRole("button", { name: "Save grade" }).click();
  await expect(edit.getByText("Saved")).toBeVisible();
  await expect(page.getByRole("button", { name: "Bola Online, Memory verse test" })).toContainText(
    "8.00draft",
  );

  // A paper test imported from CSV: check first, then import.
  await addColumn(page, "Paper test", "50", "10");
  const who = await page
    .getByRole("rowheader", { name: /Bola Online/ })
    .locator("div")
    .nth(1)
    .textContent();
  const matric = (who ?? "").split(" · ")[0] ?? "";
  expect(matric).not.toBe("");
  await page.getByText("Import scores from CSV").click();
  const upload = page.getByRole("form", { name: "Import scores" });
  await upload.getByLabel("Column").selectOption({ label: "Paper test (out of 50.00)" });
  await upload.getByLabel("CSV file").setInputFiles({
    name: "paper-test.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`matric_number,score\n${matric},41.5\nGLIM/NOBODY,3\n`),
  });
  await upload.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByText(/Line 3 \(GLIM\/NOBODY\)/)).toBeVisible();
  await upload.getByLabel("CSV file").setInputFiles({
    name: "paper-test.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`matric_number,score\n${matric},41.5\n`),
  });
  await upload.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByText("1 new, 0 changed, 0 unchanged, 0 with problems.")).toBeVisible();
  await page.getByRole("button", { name: "Import 1 scores" }).click();
  await expect(page.getByText(/Imported 1 scores/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Bola Online, Paper test" })).toContainText(
    "41.50draft",
  );

  await page.getByRole("button", { name: "Release 1 grades for Memory verse test" }).click();
  await expect(page.getByRole("button", { name: "Bola Online, Memory verse test" })).toHaveText(
    "8.00",
  );
  await page.getByRole("button", { name: "Sign out" }).click();

  await signIn(page, STUDENT);
  await page.getByRole("link", { name: "My courses" }).click();
  await page.getByText("Grades", { exact: true }).click();
  const released = page.getByRole("listitem", { name: "Memory verse test" });
  await expect(released).toContainText("8.00 / 10.00");
  await expect(released.locator("strong")).toHaveText("Word-perfect");
  await expect(page.getByRole("listitem", { name: "Paper test" })).toHaveCount(0);
});
