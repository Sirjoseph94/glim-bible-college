import { expect, test } from "./test";

/**
 * Low-bandwidth first load (docs/ui-design-handoff.md §14, UI-6; decision UI-Q14): the sign-in
 * screen and the landing page download no fonts and no images except the 64px crest (≤ 6 KB),
 * in at most 12 requests.
 */
for (const [path, ready] of [
  ["/login", "Email"],
  ["/", "Verification code"],
] as const) {
  test(`${path} loads no fonts, only the crest image, in at most 12 requests`, async ({ page }) => {
    const requests: { type: string; url: string }[] = [];
    const imageBytes = new Map<string, number>();
    page.on("request", (request) => {
      requests.push({ type: request.resourceType(), url: request.url() });
    });
    page.on("response", async (response) => {
      if (response.request().resourceType() === "image")
        imageBytes.set(response.url(), (await response.body()).length);
    });

    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel(ready)).toBeVisible();

    expect(requests.filter((r) => r.type === "font")).toEqual([]);
    for (const image of requests.filter((r) => r.type === "image")) {
      expect(image.url, "the only image on first load is the crest").toMatch(/crest/);
      expect(imageBytes.get(image.url) ?? 0).toBeLessThanOrEqual(6 * 1024);
    }
    expect(requests.length).toBeLessThanOrEqual(12);
  });
}
