import { uploadFile } from "./upload";

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

/** Uploads a prepared passport photo straight to the bucket; returns the new file's id. */
export function uploadPassportPhoto(
  photo: Blob,
  onProgress: (fraction: number) => void,
): Promise<string> {
  return uploadFile(
    photo,
    { name: "passport-photo.jpg", mime: "image/jpeg", purpose: "PASSPORT_PHOTO" },
    onProgress,
  );
}
