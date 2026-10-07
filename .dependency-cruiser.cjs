/** Dependency rules from TRD §4.3. Run with `pnpm -w deps:check`. */
const TEST = "\\.(test|spec|itest)\\.tsx?$|/test/";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "not-to-unresolvable",
      comment: "Imports must resolve; a workspace package must declare what it imports.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "contracts-shared-are-leaves",
      comment: "contracts and shared import nothing internal except each other (§4.3.1).",
      severity: "error",
      from: { path: "^packages/(contracts|shared)/" },
      to: { path: "^(apps|packages/(db|telemetry|modules|integrations))/" },
    },
    {
      name: "telemetry-imports-shared-only",
      severity: "error",
      from: { path: "^packages/telemetry/" },
      to: { path: "^(apps|packages/(db|modules|integrations))/" },
    },
    {
      name: "db-imports-no-application-code",
      severity: "error",
      from: { path: "^packages/db/" },
      to: { path: "^(apps|packages/(modules|integrations))/" },
    },
    {
      name: "integrations-import-no-application-code",
      severity: "error",
      from: { path: "^packages/integrations/" },
      to: { path: "^(apps|packages/(db|modules))/" },
    },
    {
      name: "packages-never-import-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "modules-use-public-index-of-other-modules",
      comment: "Cross-module calls go through the module's public index.ts (§0.5, §4.3.2).",
      severity: "error",
      from: { path: "^packages/modules/src/([^/]+)/" },
      to: {
        path: "^packages/modules/src/[^/]+/",
        pathNot: ["^packages/modules/src/$1/", "^packages/modules/src/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "modules-use-ports-only",
      comment:
        "Modules may import only the ports of live-provider, video-host, storage, mail and pdf; never Google or YouTube adapters (INV-3, §4.3.3).",
      severity: "error",
      from: { path: "^packages/modules/", pathNot: TEST },
      to: {
        path: "^packages/integrations/",
        pathNot:
          "^packages/integrations/src/(live-provider|video-host|storage|mail|pdf|oidc)/port\\.ts$",
      },
    },
    {
      name: "no-provider-adapters-in-modules",
      severity: "error",
      from: { path: "^packages/modules/" },
      to: { path: "^packages/integrations/src/(google|video-host/youtube-[^/]+)/" },
    },
    {
      name: "no-orphans",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(c|m)?js$",
          "\\.d\\.ts$",
          "(^|/)(vite|vitest|drizzle|playwright|tailwind|postcss|eslint)\\.config\\.(c|m)?[jt]s$",
          TEST,
          "/main\\.tsx?$",
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|coverage|static|node_modules)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
      extensions: [".ts", ".tsx", ".js", ".json"],
      mainFields: ["module", "main", "types"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
