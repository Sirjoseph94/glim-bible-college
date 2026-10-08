import type { files, UploadPurpose } from "@glim/contracts";
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

/**
 * Uploads a file straight to the private bucket (TRD §14.1): start, PUT with progress, complete.
 * Returns the new file's id.
 */
export async function uploadFile(
  body: Blob,
  meta: { name: string; mime: string; purpose: UploadPurpose },
  onProgress: (fraction: number) => void = () => undefined,
): Promise<string> {
  const { file, upload } = await api<typeof files.createUpload>("POST", "/files/uploads", {
    body: { name: meta.name, mime: meta.mime, sizeBytes: body.size, purpose: meta.purpose },
  });
  await put(upload.url, upload.headers, body, onProgress);
  await api<typeof files.completeUpload>("POST", "/files/:id/complete", {
    params: { id: file.id },
  });
  return file.id;
}
