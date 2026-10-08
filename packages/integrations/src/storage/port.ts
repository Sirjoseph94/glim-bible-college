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
  /** The object's size and type, or null if it doesn't exist. */
  head(input: {
    bucket: string;
    key: string;
  }): Promise<{ sizeBytes: number; contentType: string | null } | null>;
  /**
   * A URL the browser PUTs the bytes to directly (TRD §14.1). The content type and length are
   * signed, so the upload must send exactly those.
   */
  presignPut(input: {
    bucket: string;
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<string>;
  /**
   * Starts a multipart upload for large files (TRD §14.1: resumable above 8 MB). The browser PUTs
   * each part to a presigned URL; parts already stored can be listed, so an interrupted upload
   * resumes where it stopped.
   */
  createMultipart(input: { bucket: string; key: string; contentType: string }): Promise<string>;
  presignUploadPart(input: {
    bucket: string;
    key: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<string>;
  /** The parts stored so far, in order. */
  listParts(input: {
    bucket: string;
    key: string;
    uploadId: string;
  }): Promise<{ partNumber: number; etag: string; sizeBytes: number }[]>;
  completeMultipart(input: {
    bucket: string;
    key: string;
    uploadId: string;
    parts: { partNumber: number; etag: string }[];
  }): Promise<void>;
  abortMultipart(input: { bucket: string; key: string; uploadId: string }): Promise<void>;
  /** A short-lived URL that downloads the object as an attachment named `fileName`. */
  presignGet(input: {
    bucket: string;
    key: string;
    fileName: string;
    expiresInSeconds: number;
  }): Promise<string>;
}

export const OBJECT_STORAGE = Symbol.for("glim.ObjectStorage");
