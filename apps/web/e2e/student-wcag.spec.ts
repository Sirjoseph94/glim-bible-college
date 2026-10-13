import { expectAccessible, signIn } from "./accessible";
import { test } from "./test";

const STUDENT = { email: "e2e-student2@glim.test", password: "student passphrase 2026" };

/**
 * TRD §18, §21.2 for a student's pages. Runs before the terminal specs graduate and then erase
 * this student, which is why wcag.spec.ts (run last) can't cover them.
 */
for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`in the ${colorScheme} theme`, () => {
    // A short screen (a phone on its side), so every page scrolls inside the shell.
    test.use({ colorScheme, viewport: { width: 390, height: 360 } });

    test("a student's pages", async ({ page }) => {
      await signIn(page, STUDENT);
      for (const path of ["/", "/courses", "/schedule", "/registration", "/results", "/profile"])
        await expectAccessible(page, path);
    });
  });
}
