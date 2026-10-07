import { loadConfig } from "@glim/shared/config";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait } from "testcontainers";
import type { TestProject } from "vitest/node";
import { prepareTemplate } from "./postgres";

export interface TestServices {
  postgresAdminUrl: string;
  s3: { endpoint: string; accessKey: string; secretKey: string };
}

const MINIO_IMAGE = "bitnamilegacy/minio:2025.7.23";

declare module "vitest" {
  export interface ProvidedContext {
    glim: TestServices;
  }
}

/**
 * Vitest global setup for integration tests: Postgres 18 and MinIO via Testcontainers, or the
 * servers named by TEST_POSTGRES_URL / TEST_S3_ENDPOINT when set (TRD §21.1).
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const { testing } = loadConfig();
  const stops: (() => Promise<unknown>)[] = [];

  let postgresAdminUrl = testing.postgresUrl;
  if (postgresAdminUrl === undefined) {
    const container = await new PostgreSqlContainer("postgres:18").start();
    stops.push(() => container.stop());
    postgresAdminUrl = container.getConnectionUri();
  }

  let s3 = { endpoint: testing.s3Endpoint ?? "", accessKey: "minioadmin", secretKey: "minioadmin" };
  if (testing.s3Endpoint === undefined) {
    // MinIO no longer publishes official images; Bitnami's legacy build is the same server.
    const minio = await new GenericContainer(MINIO_IMAGE)
      .withEnvironment({
        MINIO_ROOT_USER: "minioadmin",
        MINIO_ROOT_PASSWORD: "minioadmin",
        MINIO_DEFAULT_BUCKETS: "glim-files,glim-backups",
      })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp("/minio/health/live", 9000))
      .start();
    stops.push(() => minio.stop());
    s3 = { ...s3, endpoint: `http://${minio.getHost()}:${String(minio.getMappedPort(9000))}` };
  }

  await prepareTemplate(postgresAdminUrl);
  project.provide("glim", { postgresAdminUrl, s3 });

  return async () => {
    await Promise.all(stops.map((stop) => stop()));
  };
}
