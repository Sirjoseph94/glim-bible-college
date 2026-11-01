// Writes dist/privacy.html, dist/terms.html and dist/contact.html: static documents with the page
// rendered in and no scripts (src/prerender.tsx), so they work without JavaScript.
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const SSR = fileURLToPath(new URL("../dist-prerender", import.meta.url));

await build({
  root: ROOT,
  logLevel: "warn",
  build: { ssr: "src/prerender.tsx", outDir: SSR, emptyOutDir: true, copyPublicDir: false },
});
const { PRERENDERED, deviceThemeCss, staticDocument } = await import(
  pathToFileURL(`${SSR}/prerender.js`).href
);

const template = readFileSync(`${DIST}/index.html`, "utf8");
const theme = deviceThemeCss(readFileSync(`${ROOT}/src/styles/tokens.css`, "utf8"));
// Hashed like Vite's assets, so the API caches it forever (apps/api/src/static.ts).
const themeFile = `assets/device-theme-${createHash("sha256").update(theme).digest("hex").slice(0, 8)}.css`;
writeFileSync(`${DIST}/${themeFile}`, theme);

for (const entry of PRERENDERED) {
  writeFileSync(`${DIST}/${entry.file}`, staticDocument(template, `/${themeFile}`, entry));
  console.log(`prerendered ${entry.path} -> dist/${entry.file}`);
}
rmSync(SSR, { recursive: true, force: true });
