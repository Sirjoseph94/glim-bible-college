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

/** A datetime-local value some days from now, in the browser's (and this machine's) zone. */
function localInput(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T17:00`;
}

/**
 * TRD §14.2: a Lecturer sets and publishes an assignment; a student writes (autosaved), attaches
 * a file and submits on a phone; the Lecturer grades it with feedback.
 */
test("a Lecturer sets an assignment, a student submits, the Lecturer grades it", async ({
  page,
}) => {
  await signIn(page, LECTURER);
  await page.getByRole("link", { name: "My offerings" }).click();
  await page.getByRole("button", { name: "Assignments" }).click();
  const form = page.locator("form", { hasText: "New assignment" });
  await form.getByLabel("Title").fill("Essay on John 1");
  await form.getByLabel("Instructions (Markdown)").fill("Write **300 words** on the Word.");
  await form.getByLabel("Due (your time)").fill(localInput(3));
  await form.getByLabel("Marks").fill("20");
  await form.getByLabel("Weight (%)").fill("15");
  await form.getByRole("button", { name: "Create assignment" }).click();
  const item = page.getByRole("listitem", { name: "Essay on John 1" });
  await expect(item).toContainText("Draft · 20.00 marks · 15.00%");
  await item.getByRole("button", { name: "Publish" }).click();
  await expect(item.getByRole("link", { name: "Grade submissions" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await signIn(page, STUDENT);
  await page.getByRole("link", { name: "My courses" }).click();
  await page.getByText("Assignments", { exact: true }).click();
  await page.getByRole("link", { name: "Essay on John 1" }).click();
  await expect(page.getByText("300 words")).toBeVisible();
  await page.getByLabel("Answer").fill("In the beginning was the Word.");
  await expect(page.getByText("Draft saved")).toBeVisible();
  await page.getByLabel(/Add a file/).setInputFiles({
    name: "essay.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 my essay"),
  });
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "essay.pdf" })).toBeVisible();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText(/Attempt 1, submitted/)).toBeVisible();
  await expect(page.getByText("You've used all your attempts.")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await signIn(page, LECTURER);
  await page.getByRole("link", { name: "My offerings" }).click();
  await page.getByRole("button", { name: "Assignments" }).click();
  await page
    .getByRole("listitem", { name: "Essay on John 1" })
    .getByRole("link", { name: "Grade submissions" })
    .click();
  const row = page.getByRole("listitem", { name: "Bola Online" });
  await expect(row).toContainText("In the beginning was the Word.");
  await expect(row.getByRole("link", { name: "essay.pdf" })).toBeVisible();
  await row.getByLabel(/Score/).fill("18.5");
  await row.getByLabel("Feedback").fill("Clear and well argued.");
  await row.getByRole("button", { name: "Save grade" }).click();
  await expect(row.getByText("Saved")).toBeVisible();
  await expect(row.getByLabel(/Score/)).toHaveValue("18.50");
});
