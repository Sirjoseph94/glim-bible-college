import type { files } from "@glim/contracts";
import { api } from "../api/client";

/** Passport photos are 35 × 45 mm. */
const RATIO = 35 / 45;
/** TRD §10.2: downscaled in the browser to at most 600 px and 300 KB before upload. */
const MAX_SIDE = 600;
const MAX_BYTES = 300 * 1024;

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("This browser couldn't prepare the photo."));
      },
      "image/jpeg",
      quality,
    );
  });
}

/**
 * Crops the centre of a photo to the passport ratio and shrinks it to a small JPEG, so the
 * upload works on slow mobile data. Phone orientation (EXIF) is applied by the browser.
 */
export async function preparePassportPhoto(file: File): Promise<Blob> {
  const image = await createImageBitmap(file, { imageOrientation: "from-image" });
  let cropWidth = image.width;
  let cropHeight = Math.round(cropWidth / RATIO);
  if (cropHeight > image.height) {
    cropHeight = image.height;
    cropWidth = Math.round(cropHeight * RATIO);
  }
  const x = Math.round((image.width - cropWidth) / 2);
  const y = Math.round((image.height - cropHeight) / 2);

  let height = Math.min(MAX_SIDE, cropHeight);
  for (;;) {
    const canvas = document.createElement("canvas");
    canvas.height = height;
    canvas.width = Math.round(height * RATIO);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("This browser couldn't prepare the photo.");
    context.drawImage(image, x, y, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.75, 0.65, 0.55]) {
      const blob = await toBlob(canvas, quality);
      if (blob.size <= MAX_BYTES) {
        image.close();
        return blob;
      }
    }
    height = Math.round(height * 0.8);
  }
}

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

/** Uploads a prepared passport photo straight to the bucket; returns the new file's id. */
export async function uploadPassportPhoto(
  photo: Blob,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const { file, upload } = await api<typeof files.createUpload>("POST", "/files/uploads", {
    body: {
      name: "passport-photo.jpg",
      mime: "image/jpeg",
      sizeBytes: photo.size,
      purpose: "PASSPORT_PHOTO",
    },
  });
  await put(upload.url, upload.headers, photo, onProgress);
  await api<typeof files.completeUpload>("POST", "/files/:id/complete", {
    params: { id: file.id },
  });
  return file.id;
}
