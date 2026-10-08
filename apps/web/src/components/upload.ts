import type { files, UploadPurpose, UploadTarget } from "@glim/contracts";
import { api } from "../api/client";

/** PUTs bytes to a presigned URL, reporting progress (fetch can't report upload progress). */
function put(
  url: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("The upload didn't finish. Please try again."));
    };
    xhr.onerror = () => {
      reject(new Error("The upload was interrupted. Check your connection and try again."));
    };
    xhr.send(body);
  });
}

type Multipart = Extract<UploadTarget, { method: "MULTIPART" }>;

/** Tries a part again after a dropped connection, waiting a little longer each time. */
async function withRetries<T>(attempt: () => Promise<T>, tries = 4): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await attempt();
    } catch (error) {
      if (n >= tries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** n));
    }
  }
}

/**
 * Sends a large file in parts (TRD §14.1). A failed part is retried; if that keeps failing, the
 * server is asked which parts arrived and for fresh URLs, and only the missing parts are sent.
 */
async function putParts(
  fileId: string,
  target: Multipart,
  body: Blob,
  onProgress: (fraction: number) => void,
): Promise<void> {
  let current = target;
  for (let round = 0; ; round++) {
    const done = new Set(current.uploadedPartNumbers);
    let sent = done.size;
    try {
      for (const part of current.parts) {
        if (done.has(part.partNumber)) continue;
        const start = (part.partNumber - 1) * current.partSizeBytes;
        const chunk = body.slice(start, start + current.partSizeBytes);
        await withRetries(() =>
          put(part.url, {}, chunk, (f) => {
            onProgress((sent + f) / current.parts.length);
          }),
        );
        sent++;
        onProgress(sent / current.parts.length);
      }
      return;
    } catch (error) {
      if (round >= 2) throw error;
      current = await api<typeof files.resumeUpload>("POST", "/files/:id/resume", {
        params: { id: fileId },
      });
    }
  }
}

/**
 * Uploads a file straight to the private bucket (TRD §14.1): start, PUT (in parts above 8 MB)
 * with progress, complete. Returns the new file's id.
 */
export async function uploadFile(
  body: Blob,
  meta: { name: string; mime: string; purpose: UploadPurpose },
  onProgress: (fraction: number) => void = () => undefined,
): Promise<string> {
  const { file, upload } = await api<typeof files.createUpload>("POST", "/files/uploads", {
    body: { name: meta.name, mime: meta.mime, sizeBytes: body.size, purpose: meta.purpose },
  });
  if (upload.method === "PUT") await put(upload.url, upload.headers, body, onProgress);
  else await putParts(file.id, upload, body, onProgress);
  await api<typeof files.completeUpload>("POST", "/files/:id/complete", {
    params: { id: file.id },
  });
  return file.id;
}
