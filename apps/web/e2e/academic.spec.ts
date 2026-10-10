import { expect, test } from "./test";
import { linkToken } from "./mailbox";
import { openArea, signOut } from "./nav";

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

  await openArea(page, "Academic");
  await page.getByRole("button", { name: "Add a programme" }).click();
  const programmeSheet = page.getByRole("dialog", { name: "Add a programme" });
  await programmeSheet.getByLabel("Code (e.g. DIP)").fill("CERT");
  await programmeSheet.getByLabel("Name").fill("Certificate in Theology");
  await programmeSheet.getByRole("button", { name: "Add programme" }).click();
  await expect(page.getByText("CERT · Certificate in Theology")).toBeVisible();

  for (const [code, title, credits] of [
    ["BIB101", "Old Testament Survey", "3"],
    ["MIN101", "Introduction to Ministry", "2"],
  ] as const) {
    await page.getByRole("button", { name: "Add a course" }).click();
    const courseSheet = page.getByRole("dialog", { name: "Add a course" });
    await courseSheet.getByLabel("Code", { exact: true }).fill(code);
    await courseSheet.getByLabel("Title").fill(title);
    await courseSheet.getByLabel("Credits").fill(credits);
    await courseSheet.getByRole("button", { name: "Add course" }).click();
    await expect(courseSheet).toBeHidden();
    await expect(page.getByText(`${code} ${title}`)).toBeVisible();
  }

  await page
    .getByRole("region", { name: "Certificate in Theology" })
    .getByRole("button", { name: "New curriculum version" })
    .click();
  await expect(page.getByRole("heading", { name: "Curriculum v1" })).toBeVisible();
  await page.getByRole("button", { name: "Add a course" }).click();
  await page.getByRole("button", { name: "Add a course" }).click();
  await page.getByLabel("Course 2").selectOption({ label: "MIN101 Introduction to Ministry" });
  await page.getByLabel("Type 2").selectOption("ELECTIVE");
  await page.getByRole("button", { name: "Save placements" }).click();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByText("Draft", { exact: true })).toBeHidden();

  // The curriculum is a detail page (back link, no section links): go through the area.
  await openArea(page, "Academic");
  await page.getByRole("link", { name: "Calendar" }).click();
  await page.getByRole("button", { name: "Plan an Academic Session" }).click();
  const sessionSheet = page.getByRole("dialog", { name: "Plan an Academic Session" });
  await sessionSheet.getByLabel("Code (e.g. 2027/2028)").fill("2026/2027");
  await sessionSheet.getByLabel("Starts (September)").fill("2026-09-01");
  await sessionSheet.getByLabel("Ends (June)").fill("2027-06-30");
  await sessionSheet.getByRole("button", { name: "Plan session" }).click();
  // Scoped to this session: other specs plan sessions of their own.
  const session = page.getByRole("region", { name: "2026/2027 Session" });
  await expect(session.getByRole("heading", { name: "2026/2027 Session" })).toBeVisible();
  await expect(session.getByText("Planned", { exact: true })).toBeVisible();
  await session.getByRole("button", { name: "Activate session" }).click();
  await expect(session.getByText("Active", { exact: true })).toBeVisible();

  await session.getByRole("button", { name: "Add semester 1" }).click();
  const semesterSheet = page.getByRole("dialog", { name: "Add semester 1" });
  await semesterSheet.getByLabel("Starts", { exact: true }).fill("2026-09-07");
  await semesterSheet.getByLabel("Ends", { exact: true }).fill("2027-01-29");
  await semesterSheet.getByLabel("Exams start").fill("2027-01-11");
  await semesterSheet.getByLabel("Exams end").fill("2027-01-22");
  await semesterSheet.getByRole("button", { name: "Add semester" }).click();
  const firstSemester = session.getByRole("listitem", { name: "First Semester (S1)" });
  await expect(firstSemester.getByText("Planned", { exact: true })).toBeVisible();
  await expect(firstSemester.getByText("Mon, 11 Jan 2027")).toBeVisible();
  await firstSemester.getByRole("button", { name: "Open registration" }).click();
  await expect(firstSemester.getByText("Registration open", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add a Room" }).click();
  const roomSheet = page.getByRole("dialog", { name: "Add a Room" });
  await roomSheet.getByLabel("Room code").fill("R1");
  await roomSheet.getByLabel("Room name").fill("Main Hall");
  await roomSheet.getByLabel("Seats (optional)").fill("40");
  await roomSheet.getByRole("button", { name: "Add Room" }).click();
  await expect(page.getByRole("listitem", { name: "R1 Main Hall" })).toContainText("40 seats");

  await page.getByRole("link", { name: "Lecturers" }).click();
  await page.getByRole("button", { name: "Add a Lecturer" }).click();
  const lecturerSheet = page.getByRole("dialog", { name: "Add a Lecturer" });
  await lecturerSheet.getByLabel("Email").fill("lecturer.e2e@glim.test");
  await lecturerSheet.getByLabel("Title (e.g. Rev, Dr)").fill("Rev");
  await lecturerSheet.getByLabel("Given name").fill("Tunde");
  await lecturerSheet.getByLabel("Family name").fill("Bello");
  await lecturerSheet.getByRole("button", { name: "Add Lecturer" }).click();
  await expect(page.getByText("Rev Tunde Bello was invited by email.")).toBeVisible();

  await page.getByRole("link", { name: "Offerings" }).click();
  await page.getByRole("button", { name: "Offer a course this semester" }).click();
  const offeringSheet = page.getByRole("dialog", { name: "Offer a course this semester" });
  await offeringSheet.getByLabel("Course").selectOption({ label: "BIB101 Old Testament Survey" });
  await offeringSheet.getByLabel("Primary Lecturer").selectOption({ label: "Rev Tunde Bello" });
  await offeringSheet.getByRole("button", { name: "Create offering" }).click();
  await expect(page.getByRole("listitem", { name: "Rev Tunde Bello" })).toContainText("Primary");
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Students (0 enrolled)" })).toBeVisible();

  await signOut(page);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.goto(`/invite/${await linkToken("lecturer.e2e@glim.test", "invite")}`);
  await page.getByLabel("New password (at least 12 characters)").fill("lecturer passphrase 2026");
  await page.getByLabel("Confirm the new password").fill("lecturer passphrase 2026");
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await openArea(page, "Teaching");
  const course = page.getByRole("link", { name: /Old Testament Survey/ });
  await expect(course).toContainText("BIB101");
  await expect(course).toContainText("Rev Tunde Bello");
});
