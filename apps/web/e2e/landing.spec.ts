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
    "Study theology on campus or online",
  );
  await expect(page.getByTestId("institution-name").first()).not.toBeEmpty();

  const programmes = page.getByRole("region", { name: "Programmes" });
  await expect(
    programmes.getByRole("listitem").filter({ hasText: "Diploma in Ministry" }),
  ).toContainText("One course at a time");

  // Admissions says where the Intake stands, in words, whatever state the suite left it in.
  await expect(page.getByRole("region", { name: "Admissions" })).toContainText(
    /Applications .* (open|closed)|no intake scheduled/i,
  );

  // No page-wide horizontal scroll on a phone.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  await page.getByRole("link", { name: "Apply now" }).click();
  await expect(page.getByRole("heading", { name: "Apply to study with us" })).toBeVisible();
  await page.goBack();
  await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeAttached();
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
