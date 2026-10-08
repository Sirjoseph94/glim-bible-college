import { createHash } from "node:crypto";
import { test as base } from "@playwright/test";

export { expect, type Page } from "@playwright/test";

/**
 * Each test browses as its own client address (sent in the header the e2e server trusts, as a
 * real deployment trusts its proxy's), the way separate people use separate devices. Per-IP
 * limits such as the 10 sign-ins a minute then apply per test, not to the whole suite at once.
 */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const [a = 0, b = 0, c = 0] = createHash("sha256").update(testInfo.testId).digest();
    await page.setExtraHTTPHeaders({
      "x-e2e-client-ip": `10.${String(a)}.${String(b)}.${String(c)}`,
    });
    await use(page);
  },
});
