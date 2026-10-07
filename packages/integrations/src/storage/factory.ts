import type { Config } from "@glim/shared/config";
import { S3ObjectStorage } from "./s3";

export function createObjectStorage(config: Config): S3ObjectStorage {
  const { storage } = config;
  return new S3ObjectStorage({
    endpoint: storage.endpoint,
    region: storage.region,
    accessKeyId: storage.accessKey,
    secretAccessKey: storage.secretKey,
    // Spaces accepts path-style requests too, so one setting serves both.
    forcePathStyle: true,
  });
}
