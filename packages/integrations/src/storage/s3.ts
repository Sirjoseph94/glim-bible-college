import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
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
      await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
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
