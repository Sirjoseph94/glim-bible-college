import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { designTokens } from "./design-tokens.js";

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
}).run("glim/design-tokens", designTokens, {
  valid: [
    `const a = "rounded-md bg-surface-raised p-4 text-body-sm text-ink-muted";`,
    `const b = "h-control px-5 shadow-sheet z-sheet";`,
    `const c = "#main-content";`,
    `const d = \`gap-\${size}\`;`,
    `const e = 48;`,
  ],
  invalid: [
    { code: `const a = "#1e3a5f";`, errors: [{ messageId: "colour" }] },
    { code: `const a = "rgba(0,0,0,0.5)";`, errors: [{ messageId: "colour" }] },
    { code: `const a = <path fill="#EA4335" />;`, errors: [{ messageId: "colour" }] },
    { code: `const a = { fontSize: "13px" };`, errors: [{ messageId: "px" }] },
    { code: `const a = "w-[149px] rounded";`, errors: [{ messageId: "px" }] },
    { code: `const a = "grid-cols-[1fr_2fr]";`, errors: [{ messageId: "arbitrary" }] },
    { code: "const a = `text-[13px] ${b}`;", errors: [{ messageId: "px" }] },
  ],
});
