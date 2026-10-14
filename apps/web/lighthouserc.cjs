/**
 * Lighthouse CI (TRD §18, §21.2): key routes on Lighthouse's mobile profile, whose simulated
 * throttling is slow 4G (150 ms RTT, 1.6 Mbps down) on a 4× slower CPU. The pass criterion is
 * LCP ≤ 4 s; accessibility is also checked by axe in the e2e suite.
 * Run from apps/web after `pnpm build`: `node scripts/lighthouse.mjs`. It starts the e2e stack,
 * runs the public routes, then signs in as the seeded online student and runs this config again
 * with LHCI_SESSION_COOKIE set, for the signed-in screens (decision UI-Q14). The cookie is sent
 * as a header, so Lighthouse still clears storage and measures a cold load on every run.
 * The reports in .lighthouseci then hold that cookie: it is for the throwaway e2e database, which
 * stops with the stack, and the reports are not uploaded.
 */
// eslint-disable-next-line no-restricted-syntax -- CI tooling, not app configuration (TRD §5.8).
const cookie = process.env.LHCI_SESSION_COOKIE;
const signedIn = cookie !== undefined && cookie !== "";

module.exports = {
  ci: {
    collect: {
      url: (signedIn
        ? ["/", "/courses", "/schedule"]
        : ["/", "/login", "/apply", "/verify/NOTACODE"]
      ).map((path) => `http://localhost:4173${path}`),
      numberOfRuns: 3,
      settings: {
        preset: "perf",
        formFactor: "mobile",
        throttlingMethod: "simulate",
        ...(signedIn ? { extraHeaders: { Cookie: cookie } } : {}),
      },
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
    upload: {
      target: "filesystem",
      outputDir: signedIn ? ".lighthouseci/signed-in" : ".lighthouseci/public",
    },
  },
};
