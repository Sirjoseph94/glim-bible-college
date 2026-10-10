import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { designTokens } from "./apps/web/eslint/design-tokens.js";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "apps/api/static/**",
      "packages/db/migrations/**",
      ".scratch/**",
      ".agents/**",
      ".claude/**",
      "docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }],
      "@typescript-eslint/consistent-type-imports": "error",
      // TanStack Router signals redirects by throwing its Redirect object.
      "@typescript-eslint/only-throw-error": [
        "error",
        { allow: [{ from: "package", package: "@tanstack/router-core", name: "Redirect" }] },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Read configuration through loadConfig() in @glim/shared/config (TRD §5.8).",
        },
      ],
    },
  },
  {
    files: [
      "packages/modules/**/*.ts",
      "packages/integrations/**/*.ts",
      "packages/shared/**/*.ts",
      "packages/contracts/**/*.ts",
    ],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-exports": [
        "error",
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
            namespaceFrom: true,
          },
        },
      ],
    },
  },
  {
    // Design tokens only in the web app (UI-1); warnings until WP-UI-12 (decision UI-Q16).
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    plugins: { glim: { rules: { "design-tokens": designTokens } } },
    rules: { "glim/design-tokens": "warn" },
  },
  {
    // Routes compose screens from components/ui and components/app, never primitives directly.
    files: ["apps/web/src/routes/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "warn",
        { patterns: [{ group: ["@radix-ui/*"], message: "Import UI from components/ui." }] },
      ],
    },
  },
  {
    files: ["packages/shared/src/config.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // k6 scripts run in k6's JavaScript runtime, which provides these (load/README.md).
    files: ["load/**/*.js"],
    languageOptions: {
      globals: { __ENV: "readonly", __VU: "readonly", __ITER: "readonly", open: "readonly" },
    },
  },
);
