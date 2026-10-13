import { expect, test, type Page } from "./test";
import { openCourse, openTeaching, signOut } from "./nav";

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
  await openTeaching(page, "Pastoral Care", "Gradebook");
  await page.getByRole("button", { name: "Columns and weights" }).click();
  const add = page.getByRole("form", { name: "Add a column" });
  await add.getByLabel("Kind").selectOption("EXAM");
  await add.getByLabel("Title").fill("Semester exam");
  await add.getByLabel("Out of").fill("20");
  await add.getByLabel("Weight (%)").fill("0");
  await add.getByRole("button", { name: "Add column" }).click();
  await expect(page.getByRole("columnheader", { name: /Semester exam/ })).toBeVisible();

  // The online part: one question worth 1 point, scaled to the exam's 20.
  await page.getByRole("tab", { name: "Work" }).click();
  await page.getByText(/^Question bank/).click();
  await page.getByRole("button", { name: "Add a question" }).click();
  const bank = page.getByRole("dialog", { name: "Add a question" });
  await bank.getByLabel("Question", { exact: true }).fill("Which city did Paul write Romans from?");
  await bank.getByLabel("Option 1", { exact: true }).fill("Corinth");
  await bank.getByLabel("Option 2", { exact: true }).fill("Rome");
  await bank.getByRole("checkbox", { name: "Right answer (option 1)" }).check();
  await bank.getByRole("button", { name: "Add question" }).click();
  await expect(bank).toBeHidden();
  await expect(page.getByText(/Which city did Paul write Romans from\?/).first()).toBeVisible();

  await page.getByRole("button", { name: "New quiz", exact: true }).click();
  const builder = page.getByRole("dialog", { name: "New quiz or online exam" });
  await builder
    .getByLabel("For")
    .selectOption({ label: "Online part of Semester exam (for Online students)" });
  await builder.getByRole("checkbox", { name: /Which city did Paul/ }).check();
  await builder.getByLabel("Time limit (minutes)").fill("30");
  await builder.getByRole("button", { name: "Create online exam" }).click();
  await expect(builder).toBeHidden();
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
  await signOut(page);

  await signIn(page, STUDENT);
  await openCourse(page, "Pastoral Care", "Work");
  await page.getByRole("link", { name: "Semester exam" }).click();
  await page.getByRole("button", { name: /^Start/ }).click();
  await page
    .getByRole("listitem", { name: "Question 1" })
    .getByRole("radio", { name: "Corinth" })
    .check();
  await expect(page.getByText("Answers saved")).toBeVisible();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Score: 1.00 / 1.00")).toBeVisible();
  await signOut(page);

  // The paper score goes in by hand; Bola's online score is already there, scaled to 20.
  await signIn(page, LECTURER);
  await openTeaching(page, "Pastoral Care", "Gradebook");
  await expect(page.getByRole("button", { name: "Bola Online, Semester exam" })).toContainText(
    "20.00draft",
  );
  // Typed straight into the cell (§9.19).
  await page.getByRole("button", { name: "Ada Campus, Semester exam" }).click();
  await page.getByLabel("Score for Ada Campus, Semester exam").fill("14.5");
  await page.getByLabel("Score for Ada Campus, Semester exam").press("Escape");
  await expect(page.getByRole("button", { name: "Ada Campus, Semester exam" })).not.toContainText(
    "14.50",
  );
  await page.getByRole("button", { name: "Ada Campus, Semester exam" }).click();
  await page.getByLabel("Score for Ada Campus, Semester exam").fill("14.5");
  await page.getByLabel("Score for Ada Campus, Semester exam").press("Tab");
  await expect(page.getByRole("button", { name: "Ada Campus, Semester exam" })).toContainText(
    "14.50draft",
  );
});
