// Low-bandwidth budgets (TRD §18.3, INV-13). Run after `vite build`; exits non-zero on a breach.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const KB = 1024;
const BUDGET = {
  initialJsTarget: 170 * KB,
  initialJsHardFail: 200 * KB,
  routeChunk: 60 * KB,
  initialCss: 30 * KB,
  requestsToInteractive: 12,
};

const manifest = JSON.parse(readFileSync(join(DIST, ".vite/manifest.json"), "utf8"));
const gz = (file) => gzipSync(readFileSync(join(DIST, file)), { level: 9 }).length;
const kb = (n) => `${(n / KB).toFixed(1)} KB`;

function closure(key, seen = new Set()) {
  const chunk = manifest[key];
  if (!chunk || seen.has(key)) return seen;
  seen.add(key);
  for (const dep of chunk.imports ?? []) closure(dep, seen);
  return seen;
}

const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);
const initial = closure(entryKey);
const initialJs = [...initial].map((k) => manifest[k].file);
const initialCss = [...initial].flatMap((k) => manifest[k].css ?? []);
const initialJsSize = initialJs.reduce((sum, f) => sum + gz(f), 0);
const initialCssSize = initialCss.reduce((sum, f) => sum + gz(f), 0);
// document + scripts + stylesheets + the first API call (institution)
const requests = 1 + initialJs.length + initialCss.length + 1;

const failures = [];
const warnings = [];
if (initialJsSize > BUDGET.initialJsHardFail)
  failures.push(`initial JS ${kb(initialJsSize)} > ${kb(BUDGET.initialJsHardFail)}`);
else if (initialJsSize > BUDGET.initialJsTarget)
  warnings.push(`initial JS ${kb(initialJsSize)} > target ${kb(BUDGET.initialJsTarget)}`);
if (initialCssSize > BUDGET.initialCss)
  failures.push(`initial CSS ${kb(initialCssSize)} > ${kb(BUDGET.initialCss)}`);
if (requests > BUDGET.requestsToInteractive)
  failures.push(`${requests} requests to first screen > ${BUDGET.requestsToInteractive}`);

console.log(`initial JS  ${kb(initialJsSize)} gzip (${initialJs.length} files)`);
console.log(`initial CSS ${kb(initialCssSize)} gzip`);
console.log(`requests to first screen: ${requests}`);

for (const [key, chunk] of Object.entries(manifest)) {
  if (!chunk.isDynamicEntry) continue;
  const own = [...closure(key)].filter((k) => !initial.has(k)).map((k) => manifest[k].file);
  const size = own.reduce((sum, f) => sum + gz(f), 0);
  console.log(`route ${key}: ${kb(size)} gzip`);
  if (size > BUDGET.routeChunk)
    failures.push(`route chunk ${key} ${kb(size)} > ${kb(BUDGET.routeChunk)}`);
}

for (const w of warnings) console.warn(`WARN  ${w}`);
for (const f of failures) console.error(`FAIL  ${f}`);
process.exit(failures.length > 0 ? 1 : 0);
