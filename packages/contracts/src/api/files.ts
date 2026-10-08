import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

/**
 * Uploaded files (TRD §14.1). The browser sends the bytes straight to the private bucket through a
 * presigned PUT, then completes the upload; downloads redirect to a short-lived presigned GET.
 */

const idParams = z.object({ id: z.uuid() });

/** What each purpose accepts. Purposes join as their features land (materials, submissions, …). */
export const UPLOAD_PURPOSES = {
  PASSPORT_PHOTO: { mimes: ["image/jpeg", "image/png"], maxBytes: 2 * 1024 * 1024 },
  // Windows browsers often label CSV files as Excel or plain text.
  IMPORT: {
    mimes: ["text/csv", "application/vnd.ms-excel", "text/plain"],
    maxBytes: 10 * 1024 * 1024,
  },
  // Course materials: documents, slides, spreadsheets, images and audio (recordings go to YouTube).
  MATERIAL: {
    mimes: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
      "image/jpeg",
      "image/png",
      "image/webp",
      "audio/mpeg",
      "audio/mp4",
      "audio/x-m4a",
    ],
    maxBytes: 100 * 1024 * 1024,
  },
} as const;

/** Files above this go up in parts, so a dropped connection costs one part, not the file (§14.1). */
export const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;
/** The size of every part but the last (S3 needs at least 5 MiB). */
export const MULTIPART_PART_BYTES = 8 * 1024 * 1024;

export type UploadPurpose = keyof typeof UPLOAD_PURPOSES;

export const fileSchema = z.object({
  id: z.uuid(),
  purpose: z.enum(ENUMS["files.purpose"]),
  originalName: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(ENUMS["files.status"]),
  /** Where the file can be fetched by those allowed to see it (a redirect to the bucket). */
  downloadPath: z.string(),
});

export type FileView = z.infer<typeof fileSchema>;

const multipartSchema = z.object({
  method: z.literal("MULTIPART"),
  partSizeBytes: z.number().int(),
  /** Every part, with a URL to PUT it to (no headers needed). */
  parts: z.array(z.object({ partNumber: z.number().int(), url: z.string() })),
  /** Parts the bucket already holds, which a resumed upload skips. */
  uploadedPartNumbers: z.array(z.number().int()),
  expiresAt: z.iso.datetime(),
});

/** Where to send the bytes: one presigned PUT, or (above 8 MB) one per part. */
export const uploadTargetSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("PUT"),
    url: z.string(),
    /** Send exactly these headers with the PUT; they are part of the signature. */
    headers: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  }),
  multipartSchema,
]);

export type UploadTarget = z.infer<typeof uploadTargetSchema>;

export const createUpload = endpoint({
  method: "POST",
  path: "/files/uploads",
  summary: "Start an upload: returns a presigned URL to PUT the bytes to",
  tag: "Files",
  auth: "session",
  body: z
    .object({
      name: z.string().trim().min(1).max(200),
      mime: z.string().trim().toLowerCase().max(100),
      sizeBytes: z.number().int().positive(),
      purpose: z.enum(Object.keys(UPLOAD_PURPOSES) as [UploadPurpose, ...UploadPurpose[]]),
    })
    .strict(),
  response: z.object({ file: fileSchema, upload: uploadTargetSchema }),
  successStatus: 201,
});

export const resumeUpload = endpoint({
  method: "POST",
  path: "/files/:id/resume",
  summary: "Fresh part URLs for an unfinished multipart upload, and the parts already stored",
  tag: "Files",
  auth: "session",
  params: idParams,
  response: multipartSchema,
  successStatus: 200,
});

export const completeUpload = endpoint({
  method: "POST",
  path: "/files/:id/complete",
  summary: "Confirm the bytes arrived (the size is checked) and make the file available",
  tag: "Files",
  auth: "session",
  params: idParams,
  response: fileSchema,
  successStatus: 200,
});

export const downloadFile = endpoint({
  method: "GET",
  path: "/files/:id/download",
  summary: "Redirect to a 5-minute download URL, for the owner and those allowed to see the file",
  tag: "Files",
  auth: "session",
  params: idParams,
  response: z.object({}),
  successStatus: 302,
});
