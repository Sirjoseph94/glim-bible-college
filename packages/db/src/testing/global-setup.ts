import type { TestProject } from "vitest/node";
import { startTestServices } from "./services";

/** Vitest global setup for integration tests: the shared test services (TRD §21.1). */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const { stop, ...services } = await startTestServices();
  project.provide("glim", services);
  return stop;
}
