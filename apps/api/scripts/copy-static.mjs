// Copies the built SPA into the API's static directory so one origin serves both (TRD §4.1).
import { cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../../web/dist", import.meta.url));
const to = fileURLToPath(new URL("../static", import.meta.url));
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true, filter: (src) => !src.includes("/.vite") });
