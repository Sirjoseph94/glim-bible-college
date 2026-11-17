import { expect, test } from "./test";

/**
 * The public landing page (decision D-UI-02): a signed-out visitor to / sees what the college
 * offers and the ways in, from real data only. A signed-in person's / stays their Home.
 */
test("a signed-out visitor sees the landing page, its Programmes and the ways in", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Study the Word. Serve with purpose.",
  );
  await expect(page.getByTestId("institution-name").first()).not.toBeEmpty();

  const programmes = page.getByRole("region", { name: "Programmes" });
  const diploma = programmes.getByRole("listitem").filter({ hasText: "Diploma in Ministry" });
  await expect(diploma.first()).toContainText("One course at a time");
  await expect(diploma.first().getByRole("list", { name: "Study Modes" })).toContainText(
    /On-campus\s*Online/,
  );

  const courses = page.getByRole("region", { name: "Courses" });
  await expect(courses.getByTestId("course-list")).toContainText("PAS101");
  await expect(courses.getByTestId("course-list")).toContainText("Pastoral Care");

  const tuition = page.getByRole("region", { name: "Fees and course access" });
  await expect(tuition).toContainText("₦100,000 per year");
  await expect(tuition).toContainText("€300 per year for a single student");
  await expect(tuition).toContainText("€500 per year for a couple (two students)");
  await expect(tuition).toContainText("Installment payments are accepted");
  await expect(tuition).toContainText("using a code provided by the institution");

  const teaching = page.getByRole("region", { name: "Live teaching in every course" });
  await expect(teaching).toContainText("Tuesdays and Thursdays, 9:00 pm to 11:00 pm Nigerian time");
  await expect(teaching).toContainText("join classes online on their devices");
  await expect(page.locator("body")).not.toContainText(/Google Meet|Dial in by phone/);

  // The hero's badge says where the Intake stands, whatever state the suite left it in.
  await expect(page.getByTestId("intake-badge")).toContainText(
    /Applications (open|closed)|No Intake scheduled/,
  );

  // The four steps, in order, the last one highlighted as the one that makes you a student.
  const steps = page.getByRole("region", { name: "How to apply" }).getByRole("listitem");
  await expect(steps).toHaveCount(4);
  await expect(steps.last()).toContainText("Accept your Offer");

  // Red is for live classes only: the phone picture's badge and button.
  const signals = page.getByRole("region", { name: "Built for weak signals" });
  await expect(signals).toContainText("Students can join classes online on their devices.");
  await expect(signals).toContainText("40 MB per hour");

  // No page-wide horizontal scroll on a phone.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  await page
    .getByRole("region", { name: "Study the Word. Serve with purpose." })
    .getByRole("link", { name: "See the Intake and apply" })
    .click();
  await expect(page.getByRole("heading", { name: "Apply to study with us" })).toBeVisible();
  await page.goBack();
  await page.getByRole("link", { name: "Sign in to GLIM LMS" }).first().click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeAttached();
});

test("on a phone the section links and Sign in fold into the menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const banner = page.getByRole("banner");
  await expect(banner.getByRole("link", { name: "How to apply" })).toBeHidden();

  await banner.getByText("Menu").click();
  await banner.getByRole("link", { name: "How to apply" }).click();
  await expect(page).toHaveURL(/#how-to-apply$/);
  await expect(banner.getByRole("link", { name: "How to apply" })).toBeHidden();

  await banner.getByText("Menu").click();
  await page.keyboard.press("Escape");
  await expect(banner.getByRole("link", { name: "Sign in to GLIM LMS" })).toBeHidden();
});

test("the questions open to their answers", async ({ page }) => {
  await page.goto("/");
  const faq = page.getByRole("region", { name: "Questions" });
  await faq.getByText("Do I need a Google account?").click();
  await expect(faq).toContainText("A Google account is free");
});

test("anyone can check a transcript's verification code from the landing page", async ({
  page,
}) => {
  await page.goto("/");
  const verify = page.getByRole("region", { name: "Verify a transcript" });
  await verify.getByLabel("Verification code").fill("  notacode ");
  await verify.getByRole("button", { name: "Check transcript" }).click();
  await expect(page).toHaveURL(/\/verify\/NOTACODE$/);
});

test("the privacy policy and terms open as static pages, with no scripts", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await footer.getByRole("link", { name: "Privacy policy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy policy");
  await expect(page.locator("script")).toHaveCount(0);

  await page.goBack();
  await footer.getByRole("link", { name: "Terms of service" }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms of Service");
  await expect(page.locator("script")).toHaveCount(0);
});
