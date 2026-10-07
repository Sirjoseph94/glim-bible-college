import type { Readable } from "node:stream";

/** S3-compatible object storage: DigitalOcean Spaces in production, MinIO locally (TRD §4.2). */
export interface ObjectStorage {
  /** Streams a body to `bucket/key`, multipart where needed. */
  upload(input: {
    bucket: string;
    key: string;
    body: Readable | Uint8Array;
    contentType: string;
  }): Promise<void>;
  /** The whole object, or null if it doesn't exist. */
  download(input: { bucket: string; key: string }): Promise<Uint8Array | null>;
  list(input: { bucket: string; prefix: string }): Promise<string[]>;
  remove(input: { bucket: string; key: string }): Promise<void>;
}

export const OBJECT_STORAGE = Symbol.for("glim.ObjectStorage");
