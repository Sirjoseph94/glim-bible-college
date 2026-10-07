import { existsSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyReply, FastifyRequest } from "fastify";

/** Where the Docker build copies the built SPA (apps/web/dist). */
export const DEFAULT_STATIC_DIR = fileURLToPath(new URL("../static", import.meta.url));

const HASHED_ASSET = /[.-][A-Za-z0-9_-]{6,}\.(?:js|css|woff2|svg|png|webp|avif|ico)$/;

export function hasStaticDir(dir: string): boolean {
  return existsSync(`${dir}/index.html`);
}

/** Hashed assets are cached forever; index.html is always revalidated (TRD §18.3). */
export function setStaticHeaders(reply: FastifyReply, path: string): void {
  void reply.header(
    "cache-control",
    HASHED_ASSET.test(basename(path)) ? "public, max-age=31536000, immutable" : "no-cache",
  );
}

/** Browser navigations to client-side routes get the SPA shell; API misses stay 404 JSON. */
export function spaFallback(req: FastifyRequest, reply: FastifyReply): boolean {
  const path = req.url.split("?")[0] ?? "";
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (path.startsWith("/api/") || path === "/healthz" || path === "/readyz") return false;
  if (!(req.headers.accept ?? "").includes("text/html")) return false;
  void reply.header("cache-control", "no-cache").sendFile("index.html");
  return true;
}
