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

/**
 * TRD §14.2, C-34: a hybrid exam on a phone. The Lecturer adds an exam column and its timed
 * online part, lets one On-campus student sit online, and enters a paper score; an Online
 * student sits it online and their score lands, scaled, in the same column.
 */
test("a hybrid exam: paper scores and an online part in one gradebook column", async ({ page }) => {
  await signIn(page, LECTURER);
  await page.getByRole("link", { name: "My offerings" }).click();
  await page.getByRole("link", { name: "Gradebook" }).click();
  await page.getByText("Columns and weights").click();
  const add = page.getByRole("form", { name: "Add a column" });
  await add.getByLabel("Kind").selectOption("EXAM");
  await add.getByLabel("Title").fill("Semester exam");
  await add.getByLabel("Out of").fill("20");
  await add.getByLabel("Weight (%)").fill("0");
  await add.getByRole("button", { name: "Add column" }).click();
  await expect(page.getByRole("columnheader", { name: /Semester exam/ })).toBeVisible();

  // The online part: one question worth 1 point, scaled to the exam's 20.
  await page.getByRole("link", { name: "Back to teaching" }).click();
  await page.getByRole("button", { name: "Quizzes" }).click();
  await page.getByText(/^Question bank/).click();
  const bank = page.locator("form", { hasText: "Add a question" });
  await bank.getByLabel("Question").fill("Which city did Paul write Romans from?");
  await bank.getByLabel("Option 1").fill("Corinth");
  await bank.getByLabel("Option 2").fill("Rome");
  await bank.getByRole("checkbox", { name: "Right answer" }).first().check();
  await bank.getByRole("button", { name: "Add question" }).click();
  await expect(page.getByText(/Which city did Paul write Romans from\?/).first()).toBeVisible();

  const builder = page.locator("form", { hasText: "New quiz" });
  await builder
    .getByLabel("For")
    .selectOption({ label: "Online part of Semester exam (for Online students)" });
  await builder.getByRole("checkbox", { name: /Which city did Paul/ }).check();
  await builder.getByLabel("Time limit (minutes)").fill("30");
  await builder.getByRole("button", { name: "Create online exam" }).click();
  const item = page.getByRole("listitem", { name: "Semester exam" });
  await expect(item).toContainText("Online exam · 1 questions · 20.00 marks");
  await item.getByRole("button", { name: "Publish" }).click();

  // Ada is On-campus but travelling: she may sit online.
  await item.getByRole("link", { name: "Attempts and essays" }).click();
  const grant = page.getByRole("form", { name: "Let a student sit online" });
  await grant.getByLabel("Student").selectOption({ label: "Ada Campus (GLIM/DIP/2032/0001)" });
  await grant.getByLabel("Reason").fill("Travelling for a mission");
  await grant.getByRole("button", { name: "Let them sit online" }).click();
  await expect(page.getByText("(Travelling for a mission)")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await signIn(page, STUDENT);
  await page.getByRole("link", { name: "My courses" }).click();
  await page.getByText("Quizzes", { exact: true }).click();
  await page.getByRole("link", { name: "Semester exam" }).click();
  await page.getByRole("button", { name: /^Start/ }).click();
  await page
    .getByRole("listitem", { name: "Question 1" })
    .getByRole("radio", { name: "Corinth" })
    .check();
  await expect(page.getByText("Answers saved")).toBeVisible();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Score: 1.00 / 1.00")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  // The paper score goes in by hand; Bola's online score is already there, scaled to 20.
  await signIn(page, LECTURER);
  await page.getByRole("link", { name: "My offerings" }).click();
  await page.getByRole("link", { name: "Gradebook" }).click();
  await expect(page.getByRole("button", { name: "Bola Online, Semester exam" })).toContainText(
    "20.00draft",
  );
  await page.getByRole("button", { name: "Ada Campus, Semester exam" }).click();
  const edit = page.getByRole("form", { name: "Edit grade" });
  await edit.getByLabel(/Score/).fill("14.5");
  await edit.getByRole("button", { name: "Save grade" }).click();
  await expect(page.getByRole("button", { name: "Ada Campus, Semester exam" })).toContainText(
    "14.50draft",
  );
});
