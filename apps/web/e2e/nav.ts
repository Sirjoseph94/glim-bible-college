import type { Page } from "@playwright/test";

/**
 * Opens an area from the main navigation (decision D-UI-01): from the bottom bar, or from its
 * "More" sheet when the person has more areas than the bar holds.
 */
export async function openArea(page: Page, label: string): Promise<void> {
  const main = page.getByRole("navigation", { name: "Main" });
  // Every person's bar starts with Home; wait for it before deciding where the area is.
  await main.getByRole("link", { name: "Home", exact: true }).waitFor();
  const link = main.getByRole("link", { name: label, exact: true });
  if (!(await link.isVisible())) await main.getByRole("button", { name: "More" }).click();
  const target = page.getByRole("link", { name: label, exact: true });
  const href = (await target.first().getAttribute("href")) ?? "";
  await target.first().click();
  // Wait for the area itself. The URL changes first; the previous page (a Home with a link to
  // every area) stays on screen until the area's code and data have loaded, and the caller's
  // next locator could match it.
  await page.waitForURL((url) => url.pathname === href);
  await page.waitForLoadState("networkidle");
}

/** Signs out from the account menu (a detail page's bar has none, so from Home). */
export async function signOut(page: Page): Promise<void> {
  const account = page.getByRole("button", { name: "Account" });
  if (!(await account.isVisible())) await page.goto("/");
  await account.click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
}

/** Opens one of the student's courses from My courses, at the given tab (§11.3). */
export async function openCourse(page: Page, title: string, tab: string): Promise<void> {
  await openArea(page, "Courses");
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
}

/** Opens one of the Lecturer's courses from Teaching, at the given tab (§11.9). */
export async function openTeaching(page: Page, title: string, tab: string): Promise<void> {
  await openArea(page, "Teaching");
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
}
