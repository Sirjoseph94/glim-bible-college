import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./test";

/**
 * The design-system primitives in the /dev/ui gallery (docs/ui-design-handoff.md §13, §16.1):
 * no WCAG 2.1 A/AA violations in either theme, and the keyboard behaviour of the overlays and
 * tabs. The gallery exists only in the e2e build (VITE_DEV_UI=true).
 */

async function expectAccessible(page: Page, include?: string) {
  const axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  const { violations } = await (include ? axe.include(include) : axe).analyze();
  expect(
    violations.map((v) => ({ rule: v.id, targets: v.nodes.map((n) => n.target.join(" ")) })),
  ).toEqual([]);
}

test("every primitive passes axe, in the light and the dark theme", async ({ page }) => {
  // The gallery draws each primitive twice, in a light and a dark panel.
  await page.goto("/dev/ui");
  await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible();
  await expectAccessible(page);
});

test("the page and its overlays pass axe in the dark theme", async ({ page }) => {
  await page.goto("/dev/ui");
  await page.getByRole("button", { name: "Dark page" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectAccessible(page);
  await page.getByRole("button", { name: "Choose quality" }).click();
  await expect(page.getByRole("dialog", { name: "Video quality" })).toBeVisible();
  await expectAccessible(page, '[role="dialog"]');
});

test("a sheet traps focus, closes on Escape and gives focus back", async ({ page }) => {
  await page.goto("/dev/ui");
  const opener = page.getByRole("button", { name: "Choose quality" });
  // Keyboard users are the ones who need focus back; a tap on a phone doesn't focus a button.
  await opener.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Video quality" });
  await expect(sheet).toBeVisible();
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    await expect(sheet.locator(":focus")).toHaveCount(1);
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
});

test("a confirmation that needs a reason won't go ahead without one", async ({ page }) => {
  await page.goto("/dev/ui");
  await page.getByRole("button", { name: "Change attendance" }).click();
  const dialog = page.getByRole("dialog", { name: "Change attendance for Tunde Bakare?" });
  await dialog.getByRole("button", { name: "Mark as Excused" }).click();
  await expect(dialog.getByText("Give a reason.")).toBeVisible();
  await expect(dialog.getByLabel("Reason")).toBeFocused();

  await dialog.getByLabel("Reason").fill("Was in hospital");
  await dialog.getByRole("button", { name: "Mark as Excused" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("status").filter({ hasText: "Marked Excused: Was in hospital" }),
  ).toBeVisible();
});

test("tabs move with the arrow keys", async ({ page }) => {
  await page.goto("/dev/ui");
  const overview = page.getByRole("tab", { name: "Overview" });
  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Recordings" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tabpanel")).toHaveText("Showing recordings.");
});

test("a menu opens from the keyboard and Escape returns to its trigger", async ({ page }) => {
  await page.goto("/dev/ui");
  const trigger = page.getByRole("button", { name: "More actions" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Profile" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(trigger).toBeFocused();
});
