import type { FileView } from "@glim/contracts";
import { expect } from "vitest";
import type { TestApp } from "./harness";

export interface StartedUpload {
  file: FileView;
  upload: { method: "PUT"; url: string; headers: Record<string, string> };
}

export const PHOTO = Buffer.from("\x89PNG\r\n\x1a\n pretend passport photo bytes");

export function startUpload(
  t: TestApp,
  headers: Record<string, string>,
  body: { name?: string; mime?: string; sizeBytes?: number; purpose?: string } = {},
) {
  return t.request({
    method: "POST",
    url: "/api/v1/files/uploads",
    headers,
    payload: {
      name: "me.png",
      mime: "image/png",
      sizeBytes: PHOTO.length,
      purpose: "PASSPORT_PHOTO",
      ...body,
    },
  });
}

/** Uploads a photo as the browser does: start, PUT straight to the bucket, complete. */
export async function uploadPhoto(t: TestApp, headers: Record<string, string>): Promise<FileView> {
  const started = (await startUpload(t, headers)).json<StartedUpload>();
  const put = await fetch(started.upload.url, {
    method: "PUT",
    headers: started.upload.headers,
    body: PHOTO,
  });
  expect(put.status).toBe(200);
  const done = await t.request({
    method: "POST",
    url: `/api/v1/files/${started.file.id}/complete`,
    headers,
  });
  expect(done.statusCode).toBe(200);
  return done.json<FileView>();
}
