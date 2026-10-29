import {
  AbortMultipartUploadCommand,
  BucketAlreadyOwnedByYou,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorage } from "./port";

export interface S3Options {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO needs path-style addressing; Spaces works with either. */
  forcePathStyle?: boolean;
}

/** ObjectStorage over the S3 API (DO Spaces, MinIO). */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(options: S3Options) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? true,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async upload(input: Parameters<ObjectStorage["upload"]>[0]): Promise<void> {
    await new Upload({
      client: this.client,
      params: {
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      },
    }).done();
  }

  async download(input: { bucket: string; key: string }): Promise<Uint8Array | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
      );
      return res.Body ? await res.Body.transformToByteArray() : null;
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  async list(input: { bucket: string; prefix: string }): Promise<string[]> {
    const res = await this.client.send(
      new ListObjectsV2Command({ Bucket: input.bucket, Prefix: input.prefix }),
    );
    return (res.Contents ?? []).flatMap((o) => (o.Key === undefined ? [] : [o.Key]));
  }

  /** Creates the bucket if it doesn't exist (local and test setups; production buckets come from the runbook). */
  async ensureBucket(bucket: string): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (error) {
        // Another process (a parallel test file) created it between the two calls.
        if (!(error instanceof BucketAlreadyOwnedByYou)) throw error;
      }
    }
  }

  async remove(input: { bucket: string; key: string }): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key }));
  }

  async head(input: { bucket: string; key: string }) {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
      );
      return { sizeBytes: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
    } catch (error) {
      if (error instanceof NotFound || error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  presignPut(input: Parameters<ObjectStorage["presignPut"]>[0]): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.sizeBytes,
      }),
      {
        expiresIn: input.expiresInSeconds,
        signableHeaders: new Set(["content-type", "content-length"]),
      },
    );
  }

  async createMultipart(input: Parameters<ObjectStorage["createMultipart"]>[0]): Promise<string> {
    const res = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: input.bucket,
        Key: input.key,
        ContentType: input.contentType,
      }),
    );
    if (res.UploadId === undefined) throw new Error("CreateMultipartUpload returned no UploadId");
    return res.UploadId;
  }

  presignUploadPart(input: Parameters<ObjectStorage["presignUploadPart"]>[0]): Promise<string> {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: input.bucket,
        Key: input.key,
        UploadId: input.uploadId,
        PartNumber: input.partNumber,
      }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  async listParts(input: Parameters<ObjectStorage["listParts"]>[0]) {
    const parts: { partNumber: number; etag: string; sizeBytes: number }[] = [];
    let marker: string | undefined;
    for (;;) {
      const res = await this.client.send(
        new ListPartsCommand({
          Bucket: input.bucket,
          Key: input.key,
          UploadId: input.uploadId,
          ...(marker === undefined ? {} : { PartNumberMarker: marker }),
        }),
      );
      for (const part of res.Parts ?? [])
        if (part.PartNumber !== undefined && part.ETag !== undefined)
          parts.push({ partNumber: part.PartNumber, etag: part.ETag, sizeBytes: part.Size ?? 0 });
      if (res.IsTruncated !== true || res.NextPartNumberMarker === undefined) break;
      marker = res.NextPartNumberMarker;
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipart(input: Parameters<ObjectStorage["completeMultipart"]>[0]): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: input.bucket,
        Key: input.key,
        UploadId: input.uploadId,
        MultipartUpload: {
          Parts: input.parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  async abortMultipart(input: Parameters<ObjectStorage["abortMultipart"]>[0]): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: input.bucket,
        Key: input.key,
        UploadId: input.uploadId,
      }),
    );
  }

  presignGet(input: Parameters<ObjectStorage["presignGet"]>[0]): Promise<string> {
    const safeName = input.fileName.replaceAll(/[^\w.-]+/g, "_");
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ResponseContentDisposition: `attachment; filename="${safeName}"`,
      }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  destroy(): void {
    this.client.destroy();
  }
}
