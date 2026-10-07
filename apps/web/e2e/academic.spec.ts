import { expect, test } from "@playwright/test";
import { linkToken } from "./mailbox";

const EMAIL = "e2e-academic@glim.test";
const PASSWORD = "academic passphrase 2026";

test("the Academic Admin sets up a programme, courses and an active curriculum", async ({
  page,
}) => {
  await page.goto(`/invite/${await linkToken(EMAIL, "invite")}`);
  await page.getByLabel("New password (at least 12 characters)").fill(PASSWORD);
  await page.getByLabel("Confirm the new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Ade Academic" })).toBeVisible();

  await page.getByRole("link", { name: "Academic" }).click();
  await page.getByText("Add a programme").click();
  await page.getByLabel("Code (e.g. DIP)").fill("CERT");
  await page.getByLabel("Name").fill("Certificate in Theology");
  await page.getByRole("button", { name: "Add programme" }).click();
  await expect(page.getByText("CERT · Certificate in Theology")).toBeVisible();

  await page.getByText("Add a course").click();
  for (const [code, title, credits] of [
    ["BIB101", "Old Testament Survey", "3"],
    ["MIN101", "Introduction to Ministry", "2"],
  ] as const) {
    await page.getByLabel("Code", { exact: true }).fill(code);
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Credits").fill(credits);
    await page.getByRole("button", { name: "Add course" }).click();
    await expect(page.getByText(`${code} ${title}`)).toBeVisible();
  }

  await page.getByRole("button", { name: "New curriculum version" }).click();
  await expect(page.getByRole("heading", { name: /Curriculum v1/ })).toBeVisible();
  await page.getByRole("button", { name: "Add a course" }).click();
  await page.getByRole("button", { name: "Add a course" }).click();
  await page.getByLabel("Course 2").selectOption({ label: "MIN101 Introduction to Ministry" });
  await page.getByLabel("Type 2").selectOption("ELECTIVE");
  await page.getByRole("button", { name: "Save placements" }).click();
  await page.getByRole("button", { name: "Activate" }).click();
  await expect(page.getByRole("heading", { name: /Curriculum v1 · active/ })).toBeVisible();

  await page.getByRole("link", { name: "Calendar" }).click();
  await page.getByText("Plan an Academic Session").click();
  await page.getByLabel("Code (e.g. 2027/2028)").fill("2026/2027");
  await page.getByLabel("Starts (September)").fill("2026-09-01");
  await page.getByLabel("Ends (June)").fill("2027-06-30");
  await page.getByRole("button", { name: "Plan session" }).click();
  await expect(page.getByRole("heading", { name: /2026\/2027 Session · planned/ })).toBeVisible();
  // Scoped to this session: other specs plan sessions of their own.
  const session = page.getByRole("region", { name: "2026/2027 Session" });
  await session.getByRole("button", { name: "Activate session" }).click();
  await expect(page.getByRole("heading", { name: /2026\/2027 Session · active/ })).toBeVisible();

  await session.getByText("Add semester 1").click();
  await session.getByLabel("Starts", { exact: true }).fill("2026-09-07");
  await session.getByLabel("Ends", { exact: true }).fill("2027-01-29");
  await session.getByLabel("Exams start").fill("2027-01-11");
  await session.getByLabel("Exams end").fill("2027-01-22");
  await session.getByRole("button", { name: "Add semester" }).click();
  await expect(session.getByText("First Semester (S1) · planned")).toBeVisible();
  await expect(session.getByText("Mon, 11 Jan 2027")).toBeVisible();
  await session.getByRole("button", { name: "Open registration" }).click();
  await expect(page.getByText("First Semester (S1) · registration")).toBeVisible();

  await page.getByLabel("Room code").fill("R1");
  await page.getByLabel("Room name").fill("Main Hall");
  await page.getByLabel("Seats (optional)").fill("40");
  await page.getByRole("button", { name: "Add Room" }).click();
  await expect(page.getByText("40 seats")).toBeVisible();

  await page.getByRole("link", { name: "Lecturers" }).click();
  await page.getByLabel("Email").fill("lecturer.e2e@glim.test");
  await page.getByLabel("Title (e.g. Rev, Dr)").fill("Rev");
  await page.getByLabel("Given name").fill("Tunde");
  await page.getByLabel("Family name").fill("Bello");
  await page.getByRole("button", { name: "Add Lecturer" }).click();
  await expect(page.getByText("Rev Tunde Bello was invited by email.")).toBeVisible();

  await page.getByRole("link", { name: "Offerings" }).click();
  await page.getByText("Offer a course this semester").click();
  await page.getByLabel("Course").selectOption({ label: "BIB101 Old Testament Survey" });
  await page.getByLabel("Primary Lecturer").selectOption({ label: "Rev Tunde Bello" });
  await page.getByRole("button", { name: "Create offering" }).click();
  await expect(page.getByText("Rev Tunde Bello · Primary")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(/· published/)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.goto(`/invite/${await linkToken("lecturer.e2e@glim.test", "invite")}`);
  await page.getByLabel("New password (at least 12 characters)").fill("lecturer passphrase 2026");
  await page.getByLabel("Confirm the new password").fill("lecturer passphrase 2026");
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await page.getByRole("link", { name: "My offerings" }).click();
  await expect(page.getByText("BIB101 Old Testament Survey")).toBeVisible();
  await expect(page.getByText("Rev Tunde Bello (Primary Lecturer)")).toBeVisible();
});
