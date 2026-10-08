import { randomUUID } from "node:crypto";
import {
  UPLOAD_PURPOSES,
  type FileView,
  type Permission,
  type UploadPurpose,
} from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { OBJECT_STORAGE, type ObjectStorage } from "@glim/integrations/storage/port";
import { AuthorizationService } from "@glim/modules/authorization";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { CONFIG, type Config } from "@glim/shared/config";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";

type FileRow = typeof schema.files.$inferSelect;

/** Who besides the owner may fetch a file of each purpose, and where it is kept in the bucket. */
const PURPOSE_RULES: Record<UploadPurpose, { readPermission: Permission; prefix: string }> = {
  PASSPORT_PHOTO: { readPermission: "admissions:application:read", prefix: "passport-photos" },
  IMPORT: { readPermission: "identity:import:run", prefix: "imports" },
};

const UPLOAD_URL_SECONDS = 15 * 60;
/** TRD §14.1: downloads redirect to a 5-minute presigned GET. */
const DOWNLOAD_URL_SECONDS = 5 * 60;

const notFound = () => err(domainError("NOT_FOUND", "Not found."));

export function fileView(row: FileRow): FileView {
  return {
    id: row.id,
    purpose: row.purpose as FileView["purpose"],
    originalName: row.originalName,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    status: row.status as FileView["status"],
    downloadPath: `/api/v1/files/${row.id}/download`,
  };
}

/**
 * Uploaded files (owner: content, TRD §14.1). Bytes never pass through the API: the browser PUTs
 * them to the private bucket with a presigned URL, and downloads redirect to a presigned GET.
 */
@Injectable()
export class FilesService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  /** Records a pending file and returns where to PUT its bytes; the type and size must fit the purpose. */
  async createUpload(
    ownerUserId: string,
    input: { name: string; mime: string; sizeBytes: number; purpose: UploadPurpose },
  ): Promise<
    DomainResult<{
      file: FileView;
      upload: { method: "PUT"; url: string; headers: Record<string, string>; expiresAt: string };
    }>
  > {
    const limits = UPLOAD_PURPOSES[input.purpose];
    if (!(limits.mimes as readonly string[]).includes(input.mime))
      return err(
        domainError("VALIDATION_FAILED", `Upload a ${limits.mimes.join(" or ")} file.`, {
          fieldErrors: [
            { path: "mime", code: "invalid", message: "That file type isn't accepted." },
          ],
        }),
      );
    if (input.sizeBytes > limits.maxBytes)
      return err(
        domainError(
          "VALIDATION_FAILED",
          `The file is too large: the limit is ${String(Math.round(limits.maxBytes / 1024 / 1024))} MB.`,
          { fieldErrors: [{ path: "sizeBytes", code: "too_big", message: "Too large." }] },
        ),
      );
    const now = this.clock.now();
    const storageKey = `${PURPOSE_RULES[input.purpose].prefix}/${randomUUID()}`;
    const [row] = await this.db.withTx(({ db }) =>
      db
        .insert(schema.files)
        .values({
          ownerUserId,
          purpose: input.purpose,
          storageKey,
          originalName: input.name,
          mime: input.mime,
          sizeBytes: input.sizeBytes,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
    );
    if (row === undefined) throw new Error("file insert returned nothing");
    const url = await this.storage.presignPut({
      bucket: this.config.storage.bucket,
      key: storageKey,
      contentType: input.mime,
      sizeBytes: input.sizeBytes,
      expiresInSeconds: UPLOAD_URL_SECONDS,
    });
    return ok({
      file: fileView(row),
      upload: {
        method: "PUT",
        url,
        headers: { "content-type": input.mime },
        expiresAt: new Date(now.getTime() + UPLOAD_URL_SECONDS * 1000).toISOString(),
      },
    });
  }

  /** Makes an upload available once the bytes are in the bucket with the declared size. */
  async complete(id: string, userId: string): Promise<DomainResult<FileView>> {
    const f = schema.files;
    const [row] = await this.db.read
      .select()
      .from(f)
      .where(and(eq(f.id, id), eq(f.ownerUserId, userId)));
    if (row === undefined || row.status === "DELETED") return notFound();
    if (row.status === "AVAILABLE") return ok(fileView(row));
    const bucket = this.config.storage.bucket;
    const stored = await this.storage.head({ bucket, key: row.storageKey });
    if (stored === null)
      return err(domainError("VALIDATION_FAILED", "The upload didn't arrive. Please try again."));
    if (stored.sizeBytes !== row.sizeBytes) {
      await this.storage.remove({ bucket, key: row.storageKey });
      return err(domainError("VALIDATION_FAILED", "The upload was incomplete. Please try again."));
    }
    const [updated] = await this.db.withTx(({ db }) =>
      db
        .update(f)
        .set({ status: "AVAILABLE", updatedAt: this.clock.now(), version: sql`${f.version} + 1` })
        .where(eq(f.id, id))
        .returning(),
    );
    return updated === undefined ? notFound() : ok(fileView(updated));
  }

  /**
   * A 5-minute download URL for the owner, or for someone whose role may read files of that
   * purpose; null (a 404) for everyone else, so a file's existence isn't revealed.
   */
  async downloadUrl(id: string, userId: string): Promise<string | null> {
    const f = schema.files;
    const [row] = await this.db.read.select().from(f).where(eq(f.id, id));
    if (row?.status !== "AVAILABLE") return null;
    if (row.ownerUserId !== userId) {
      const rule = PURPOSE_RULES[row.purpose as UploadPurpose] as
        (typeof PURPOSE_RULES)[UploadPurpose] | undefined;
      if (rule === undefined) return null;
      const decision = await this.authorization.authorize(
        this.authorization.principal(userId),
        rule.readPermission,
      );
      if (decision !== "ALLOW") return null;
    }
    return this.storage.presignGet({
      bucket: this.config.storage.bucket,
      key: row.storageKey,
      fileName: row.originalName,
      expiresInSeconds: DOWNLOAD_URL_SECONDS,
    });
  }

  /**
   * A short-lived download URL for files the caller has already decided may be shown, e.g. the
   * passport photos on a roll call, shown to the class's Lecturer (§12.3). Null if unavailable.
   */
  async presignedReadUrls(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const f = schema.files;
    const rows = await this.db.read
      .select({ id: f.id, storageKey: f.storageKey, name: f.originalName, status: f.status })
      .from(f)
      .where(inArray(f.id, ids));
    for (const row of rows)
      if (row.status === "AVAILABLE")
        out.set(
          row.id,
          await this.storage.presignGet({
            bucket: this.config.storage.bucket,
            key: row.storageKey,
            fileName: row.name,
            expiresInSeconds: DOWNLOAD_URL_SECONDS,
          }),
        );
    return out;
  }

  /**
   * Whether a file is the user's own, available, upload for a purpose (e.g. to attach it). Inside a
   * transaction, pass its `db` so the read uses the same connection.
   */
  async isUsable(
    id: string,
    ownerUserId: string,
    purpose: UploadPurpose,
    db: Database = this.db.read,
  ): Promise<boolean> {
    const f = schema.files;
    const [row] = await db
      .select({ id: f.id })
      .from(f)
      .where(
        and(
          eq(f.id, id),
          eq(f.ownerUserId, ownerUserId),
          eq(f.purpose, purpose),
          eq(f.status, "AVAILABLE"),
        ),
      );
    return row !== undefined;
  }

  /**
   * Deletes a file's record inside the caller's transaction (e.g. when its application is purged)
   * and returns its object key; remove the object with `removeObject` once that commits.
   */
  async deleteRecord(db: Database, id: string): Promise<string | null> {
    const f = schema.files;
    const [row] = await db.delete(f).where(eq(f.id, id)).returning({ key: f.storageKey });
    return row?.key ?? null;
  }

  /** Removes a stored object; best effort, since its record is already gone. */
  async removeObject(storageKey: string): Promise<void> {
    await this.storage.remove({ bucket: this.config.storage.bucket, key: storageKey });
  }

  /** A file's bytes and record, for server-side processing (e.g. an import); null if unavailable. */
  async read(id: string): Promise<{ file: FileView; bytes: Uint8Array } | null> {
    const f = schema.files;
    const [row] = await this.db.read.select().from(f).where(eq(f.id, id));
    if (row?.status !== "AVAILABLE") return null;
    const bytes = await this.storage.download({
      bucket: this.config.storage.bucket,
      key: row.storageKey,
    });
    return bytes === null ? null : { file: fileView(row), bytes };
  }

  /** Stores a file the server made (e.g. an import's error report), owned by `ownerUserId`. */
  async store(input: {
    ownerUserId: string;
    purpose: UploadPurpose;
    name: string;
    mime: string;
    bytes: Uint8Array;
  }): Promise<FileView> {
    const storageKey = `${PURPOSE_RULES[input.purpose].prefix}/${randomUUID()}`;
    await this.storage.upload({
      bucket: this.config.storage.bucket,
      key: storageKey,
      body: input.bytes,
      contentType: input.mime,
    });
    const now = this.clock.now();
    const [row] = await this.db.withTx(({ db }) =>
      db
        .insert(schema.files)
        .values({
          ownerUserId: input.ownerUserId,
          purpose: input.purpose,
          storageKey,
          originalName: input.name,
          mime: input.mime,
          sizeBytes: input.bytes.byteLength,
          status: "AVAILABLE",
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
    );
    if (row === undefined) throw new Error("file insert returned nothing");
    return fileView(row);
  }
}
