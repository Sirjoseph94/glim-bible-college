// Writes .br and .gz next to each text asset so @fastify/static can serve them precompressed.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const TEXT = /\.(?:js|css|html|svg|json|webmanifest|txt)$/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

for (const file of walk(DIST).filter((f) => TEXT.test(f))) {
  const body = readFileSync(file);
  writeFileSync(
    `${file}.br`,
    brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
  );
  writeFileSync(`${file}.gz`, gzipSync(body, { level: 9 }));
}
