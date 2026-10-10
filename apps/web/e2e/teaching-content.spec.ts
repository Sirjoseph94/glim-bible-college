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
 * TRD §14.1: a Lecturer (signed up in the meetings spec) posts a pinned announcement and adds a
 * text, a link and a file; an enrolled student reads them on a phone and downloads the file.
 */
test("a Lecturer shares materials and an announcement with the class", async ({ page }) => {
  await signIn(page, LECTURER);
  await openTeaching(page, "Pastoral Care", "Overview");

  await page.getByLabel("Title").first().fill("Welcome to the course");
  await page.getByLabel("Message (Markdown)").fill("Read **John 1** before *Monday*.");
  await page.getByLabel("Pin to the top").check();
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByRole("listitem", { name: "Welcome to the course" })).toContainText(
    "Read John 1 before Monday.",
  );

  await page.getByRole("tab", { name: "Materials" }).click();
  const add = page.locator("form", { hasText: "Add material" });
  await add.getByRole("radio", { name: "Text" }).check();
  await add.getByLabel("Title").fill("Study questions");
  await add.getByLabel("Section (optional), e.g. Week 1").fill("Week 1");
  await add.getByLabel("Text (Markdown)").fill("1. Who is the Word?\n\n<script>alert(1)</script>");
  await add.getByRole("button", { name: "Add material" }).click();
  await expect(page.getByRole("listitem", { name: "Study questions" })).toBeVisible();

  await add.getByRole("radio", { name: "Link" }).check();
  await add.getByLabel("Title").fill("John 1 online");
  await add.getByLabel("Section (optional), e.g. Week 1").fill("Week 1");
  await add.getByLabel("Web address").fill("https://www.biblegateway.com/passage/?search=John+1");
  await add.getByRole("button", { name: "Add material" }).click();
  await expect(page.getByRole("listitem", { name: "John 1 online" })).toBeVisible();

  await add.getByRole("radio", { name: "File" }).check();
  await add.getByLabel("Title").fill("Lecture notes");
  await add.getByLabel("File (up to 100 MB)").setInputFiles({
    name: "notes.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 week one notes"),
  });
  await add.getByRole("button", { name: "Add material" }).click();
  await expect(page.getByRole("listitem", { name: "Lecture notes" })).toContainText(
    "Download notes.pdf",
  );
  await signOut(page);

  await signIn(page, STUDENT);
  await openCourse(page, "Pastoral Care", "Overview");
  await expect(page.getByRole("listitem", { name: "Welcome to the course" })).toContainText(
    "Read John 1 before Monday.",
  );
  await page.getByRole("tab", { name: "Materials" }).click();
  const questions = page.getByRole("listitem", { name: "Study questions" });
  await expect(questions).toContainText("Who is the Word?");
  await expect(questions.locator("script")).toHaveCount(0);
  await expect(
    page.getByRole("listitem", { name: "John 1 online" }).getByRole("link", { name: "Open link" }),
  ).toHaveAttribute("href", "https://www.biblegateway.com/passage/?search=John+1");

  const download = page.waitForEvent("download");
  await page
    .getByRole("listitem", { name: "Lecture notes" })
    .getByRole("link", { name: /Download notes\.pdf/ })
    .click();
  expect((await download).suggestedFilename()).toBe("notes.pdf");
});
