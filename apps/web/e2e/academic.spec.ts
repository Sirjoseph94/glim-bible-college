import { expect, test } from "./test";
import { linkToken } from "./mailbox";
import { openArea, signOut } from "./nav";

const EMAIL = "e2e-academic@glim.test";
const PASSWORD = "academic passphrase 2026";

test("the Academic Admin sets up a programme, an ordered curriculum, and a cohort's courses", async ({
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
  // Coded after DMIN, the seeded programme that applicants apply to.
  await programmeSheet.getByLabel("Code (e.g. DIP)").fill("THEO");
  await programmeSheet.getByLabel("Name").fill("Diploma in Theology");
  await programmeSheet.getByRole("button", { name: "Add programme" }).click();
  await expect(page.getByText("THEO · Diploma in Theology")).toBeVisible();

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
    .getByRole("region", { name: "Diploma in Theology" })
    .getByRole("button", { name: "New curriculum version" })
    .click();
  await expect(page.getByRole("heading", { name: "Curriculum v1" })).toBeVisible();
  await page.getByRole("button", { name: "Add a course" }).click();
  await page.getByRole("button", { name: "Add a course" }).click();
  await page
    .getByLabel("Course 2", { exact: true })
    .selectOption({ label: "MIN101 Introduction to Ministry" });
  // The order is the order cohorts take the courses in (ADR-0005).
  await page.getByRole("button", { name: "Move course 2 earlier" }).click();
  await page.getByRole("button", { name: "Save courses" }).click();
  await expect(page.getByText("5.0 credits in all", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Course 1", { exact: true })).toHaveText(/MIN101/);
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByText("Draft", { exact: true })).toBeHidden();

  // The curriculum is a detail page (back link, no section links): go through the area.
  await openArea(page, "Academic");
  await page.getByRole("link", { name: "Cohorts" }).click();
  await page
    .getByLabel("Cohort")
    .selectOption({ label: "DMIN-2027-E2E · starts 2027-01-04 · 0 active" });
  const schedule = page.getByRole("region", { name: "DMIN-2027-E2E schedule" });
  await expect(schedule.getByText("Nothing scheduled yet")).toBeVisible();
  await schedule.getByRole("button", { name: "Plan 1 course" }).click();
  const planSheet = page.getByRole("dialog", { name: "Plan DMIN-2027-E2E's courses" });
  await planSheet.getByLabel("First course starts on").fill("2027-01-04");
  await planSheet.getByLabel("Weeks per course").fill("4");
  await planSheet.getByRole("button", { name: "Create draft offerings" }).click();
  const planned = schedule.getByRole("listitem", { name: "PAS101 Pastoral Care" });
  await expect(planned).toContainText("Mon, 4 Jan 2027");
  await expect(planned).toContainText("Draft");

  await page.getByRole("link", { name: "Rooms" }).click();
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
  await page
    .getByLabel("Cohort")
    .selectOption({ label: "DMIN-2027-E2E · Diploma in Ministry, 2027-E2E intake" });
  await page.getByRole("button", { name: "Offer a course to this cohort" }).click();
  const offeringSheet = page.getByRole("dialog", { name: "Offer a course to this cohort" });
  await offeringSheet.getByLabel("Course").selectOption({ label: "BIB101 Old Testament Survey" });
  // Straight after the planned PAS101, which ends on 31 January.
  await offeringSheet.getByLabel("Starts").fill("2027-02-01");
  await offeringSheet.getByLabel("Ends").fill("2027-02-26");
  await offeringSheet.getByLabel("Exam").fill("2027-02-26");
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
