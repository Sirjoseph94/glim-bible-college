// Writes dist/privacy.html and dist/terms.html: the built index.html with the page already
// rendered into #root (src/prerender.tsx), so the text is there without JavaScript.
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
const { PRERENDERED, renderPage } = await import(pathToFileURL(`${SSR}/prerender.js`).href);

const escape = (s) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const template = readFileSync(`${DIST}/index.html`, "utf8");
const ROOT_DIV = '<div id="root"></div>';
if (!template.includes(ROOT_DIV)) throw new Error(`prerender: ${ROOT_DIV} not found in index.html`);

for (const entry of PRERENDERED) {
  const html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(entry.title)}</title>`)
    .replace(
      "</title>",
      `</title>\n    <meta name="description" content="${escape(entry.description)}" />`,
    )
    .replace(ROOT_DIV, `<div id="root">${renderPage(entry)}</div>`);
  writeFileSync(`${DIST}/${entry.file}`, html);
  console.log(`prerendered ${entry.path} -> dist/${entry.file}`);
}
rmSync(SSR, { recursive: true, force: true });
