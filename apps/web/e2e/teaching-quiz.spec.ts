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
 * TRD §14.2: a Lecturer builds a one-minute quiz from the question bank; a student loses their
 * connection part-way, the timer runs out while offline, and the answers kept on the phone are
 * handed in when the connection returns within the server's 30 s grace.
 */
test("a timed quiz survives a dropped connection at the deadline", async ({ page, context }) => {
  test.setTimeout(180_000);
  await signIn(page, LECTURER);
  await openTeaching(page, "Pastoral Care", "Work");
  await page.getByText(/^Question bank/).click();

  await page.getByRole("button", { name: "Add a question" }).click();
  const bank = page.getByRole("dialog", { name: "Add a question" });
  await bank.getByLabel("Question", { exact: true }).fill("Who wrote the fourth Gospel?");
  await bank.getByLabel("Option 1", { exact: true }).fill("Mark");
  await bank.getByLabel("Option 2", { exact: true }).fill("John");
  await bank.getByRole("checkbox", { name: "Right answer (option 2)" }).check();
  await bank.getByRole("button", { name: "Add question" }).click();
  await expect(bank).toBeHidden();
  await expect(page.getByText(/Who wrote the fourth Gospel\? \(1\.00\)/).first()).toBeVisible();

  await page.getByRole("button", { name: "Add a question" }).click();
  await bank.getByLabel("Type").selectOption("TRUE_FALSE");
  await bank.getByLabel("Question", { exact: true }).fill("John 1 begins with In the beginning.");
  await bank.getByRole("button", { name: "Add question" }).click();
  await expect(bank).toBeHidden();
  await expect(
    page.getByText(/John 1 begins with In the beginning\. \(1\.00\)/).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "New quiz", exact: true }).click();
  const builder = page.getByRole("dialog", { name: "New quiz or online exam" });
  await builder.getByLabel("Quiz title").fill("Quick check");
  await builder.getByRole("checkbox", { name: /Who wrote the fourth Gospel/ }).check();
  await builder.getByRole("checkbox", { name: /John 1 begins/ }).check();
  await builder.getByLabel("Time limit (minutes)").fill("1");
  await builder.getByLabel("Weight (%)").fill("10");
  await builder.getByLabel("Show answers").selectOption("AFTER_ATTEMPT");
  await builder.getByRole("button", { name: "Create quiz" }).click();
  await expect(builder).toBeHidden();
  const item = page.getByRole("listitem", { name: "Quick check" });
  await expect(item).toContainText("Draft");
  await expect(item).toContainText("2 questions · 2.00 marks · 1 min");
  await item.getByRole("button", { name: "Publish" }).click();
  await expect(item.getByRole("link", { name: "Attempts and essays" })).toBeVisible();
  await signOut(page);

  await signIn(page, STUDENT);
  await openCourse(page, "Pastoral Care", "Work");
  await page.getByRole("link", { name: "Quick check" }).click();
  await page.getByRole("button", { name: /^Start/ }).click();
  await expect(page.getByRole("timer")).toHaveText(/^[01]:\d\d$/);

  const q1 = page.getByRole("listitem", { name: "Question 1" });
  const q2 = page.getByRole("listitem", { name: "Question 2" });
  await q1.getByRole("radio", { name: "John" }).check();
  await expect(page.getByText("Answers saved")).toBeVisible();

  // The connection drops; the next answer (on its own screen on a phone) is kept on the phone.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Next question" }).click();
  await q2.getByRole("radio", { name: "True" }).check();
  await expect(page.getByText(/Offline: your answers are kept/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("You are offline")).toBeVisible();

  // The timer runs out while offline; the page keeps trying to hand in.
  await expect(page.getByText("Handing in your answers…")).toBeVisible({ timeout: 75_000 });
  await page.waitForTimeout(3_000);
  await context.setOffline(false);

  // Back online within the grace: both answers count.
  await expect(page.getByText("Score: 2.00 / 2.00")).toBeVisible({ timeout: 20_000 });
  await expect(q1).toContainText("John ✓");
});
