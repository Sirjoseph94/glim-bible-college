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
} as const;

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
  response: z.object({
    file: fileSchema,
    upload: z.object({
      method: z.literal("PUT"),
      url: z.string(),
      /** Send exactly these headers with the PUT; they are part of the signature. */
      headers: z.record(z.string(), z.string()),
      expiresAt: z.iso.datetime(),
    }),
  }),
  successStatus: 201,
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
