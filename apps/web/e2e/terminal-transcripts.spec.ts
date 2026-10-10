import { expect, test, type Page } from "./test";
import { openArea, signOut } from "./nav";

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
 * TRD §14.7, AC-14: runs after Bola graduated (terminal-awards). On a phone, the graduate gets an
 * unofficial transcript at once and asks for an official one; the Registrar approves and issues
 * it; anyone with the code can check it without signing in.
 */
test("a graduate gets transcripts, the Registrar issues the official one, anyone verifies it", async ({
  page,
}) => {
  await signIn(page, STUDENT);
  await openArea(page, "Results");
  await page.getByRole("button", { name: "Get an unofficial transcript" }).click();
  const unofficial = page.getByRole("listitem", { name: /^GLIM\/TR\/\d{4}\/00001$/ });
  await expect(unofficial).toContainText("Unofficial · Diploma in Ministry");
  await unofficial.getByRole("link", { name: "View transcript" }).click();
  await expect(page.getByText(/^Unofficial transcript · GLIM\/TR\//)).toBeVisible();
  await expect(page.getByRole("cell", { name: "PAS101 Pastoral Care" })).toBeVisible();
  await expect(page.getByText(/^Awarded the Diploma with \w+ on /)).toBeVisible();

  await page.goBack();
  await page.getByRole("button", { name: "Request an official transcript" }).click();
  const form = page.getByRole("form", { name: "Official transcript" });
  await form.getByLabel("What it's for").fill("Admission to a seminary");
  await form.getByLabel("Recipient", { exact: true }).fill("Registrar, Lagos Seminary");
  await form.getByLabel("Recipient's email").fill("registrar@seminary.test");
  await form.getByRole("button", { name: "Send request" }).click();
  await expect(
    page.getByText(/Waiting for the Registrar · for Registrar, Lagos Seminary/),
  ).toBeVisible();
  await signOut(page);

  await signIn(page, REGISTRAR);
  await openArea(page, "Results");
  await page.getByRole("link", { name: "Semester results" }).click();
  await page
    .getByRole("listitem", { name: "Bola Online" })
    .getByRole("button", { name: "Approve" })
    .click();
  await page.getByLabel("Show").selectOption("APPROVED");
  await page
    .getByRole("listitem", { name: "Bola Online" })
    .getByRole("button", { name: "Issue" })
    .click();
  await page.getByLabel("Show").selectOption("ISSUED");
  const issued = page.getByRole("listitem", { name: "Bola Online" }).filter({ hasText: /\/00002/ });
  await expect(issued).toContainText("Official");
  await expect(issued).toContainText(/Issued · GLIM\/TR\/\d{4}\/00002/);
  await issued.getByRole("link", { name: "View" }).click();
  await expect(page.getByText(/^Official transcript · GLIM\/TR\/\d{4}\/00002/)).toBeVisible();
  const code = (await page.locator("footer strong").textContent()) ?? "";
  expect(code).toMatch(/^[A-Z2-7]{16}$/);

  // The worker renders the PDF; then it downloads, and goes to the recipient by email.
  const href = (await page.getByRole("link", { name: "Download PDF" }).getAttribute("href")) ?? "";
  await expect
    .poll(async () => (await page.request.get(href)).headers()["content-type"], {
      timeout: 20_000,
    })
    .toBe("application/pdf");
  const pdf = await page.request.get(href);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.getByRole("button", { name: "Email PDF" }).click();
  await expect(page.getByText("The PDF is on its way to registrar@seminary.test.")).toBeVisible();

  // The unofficial one was issued against the wrong record: revoke it.
  await page.goBack();
  await page.getByLabel("Show").selectOption("ISSUED");
  const unofficialRow = page
    .getByRole("listitem", { name: "Bola Online" })
    .filter({ hasText: /\/00001/ });
  await unofficialRow.getByRole("link", { name: "View" }).click();
  const unofficialCode = (await page.locator("footer strong").textContent()) ?? "";
  await page.getByRole("button", { name: "Revoke transcript" }).click();
  const revoke = page.getByRole("dialog", { name: /^Revoke GLIM\/TR\// });
  await revoke.getByLabel("Why it's being revoked").fill("Issued against the wrong record");
  await revoke.getByRole("button", { name: "Revoke transcript" }).click();
  await expect(
    page.getByText("This transcript was revoked: Issued against the wrong record."),
  ).toBeVisible();
  await signOut(page);

  await page.goto(`/verify/${unofficialCode}`);
  await expect(page.getByText(/This transcript was revoked and is no longer valid/)).toBeVisible();

  // Anyone, signed out.
  await page.goto(`/verify/${code}`);
  await expect(page.getByText("This transcript is genuine and valid.")).toBeVisible();
  await expect(page.getByText("B. O.")).toBeVisible();
  await expect(page.getByText("Diploma in Ministry")).toBeVisible();
  await expect(page.getByText("PAS101")).toHaveCount(0);
});
