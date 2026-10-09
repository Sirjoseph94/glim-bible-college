/**
 * Lighthouse CI (TRD §18, §21.2): the key public routes on Lighthouse's mobile profile, whose
 * simulated throttling is slow 4G (150 ms RTT, 1.6 Mbps down) on a 4× slower CPU. The pass
 * criterion is LCP ≤ 4 s; accessibility is also checked by axe in the e2e suite.
 * Run from apps/web after `pnpm build`: `pnpm dlx @lhci/cli@0.15.1 autorun`.
 */
module.exports = {
  ci: {
    collect: {
      // The e2e stack: the built web app and the API over a throwaway database.
      startServerCommand: "pnpm --filter @glim/api e2e:serve",
      startServerReadyPattern: "e2e stack ready",
      startServerReadyTimeout: 240000,
      url: [
        "http://localhost:4173/login",
        "http://localhost:4173/apply",
        "http://localhost:4173/verify/NOTACODE",
      ],
      numberOfRuns: 3,
      settings: { preset: "perf", formFactor: "mobile", throttlingMethod: "simulate" },
    },
    assert: {
      assertions: {
        "largest-contentful-paint": [
          "error",
          { maxNumericValue: 4000, aggregationMethod: "median" },
        ],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1, aggregationMethod: "median" }],
      },
    },
    upload: { target: "filesystem", outputDir: ".lighthouseci" },
  },
};
