import type { FileView } from "@glim/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, PERSONA_SPECS, type PersonaName, type Personas } from "./personas";
import { PHOTO, startUpload as start, uploadPhoto as upload, type StartedUpload } from "./uploads";

const startUpload = (headers: Record<string, string>, body?: Parameters<typeof start>[2]) =>
  start(t, headers, body);
const uploadPhoto = (headers: Record<string, string>) => upload(t, headers);

let t: TestApp;
let p: Personas;

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
});

afterAll(async () => {
  await t.close();
});

describe("uploading a passport photo", () => {
  it("accepts only JPEG or PNG, up to 2 MB", async () => {
    const pdf = await startUpload(p.applicant.headers, { name: "cv.pdf", mime: "application/pdf" });
    expect(pdf.statusCode).toBe(400);
    const huge = await startUpload(p.applicant.headers, { sizeBytes: 2 * 1024 * 1024 + 1 });
    expect(huge.statusCode).toBe(400);
    const material = await startUpload(p.applicant.headers, { purpose: "MATERIAL" });
    expect(material.statusCode).toBe(400);
  });

  it("goes straight to the bucket with a presigned URL, and is available once the size checks out", async () => {
    const started = await startUpload(p.applicant.headers);
    expect(started.statusCode).toBe(201);
    const { file, upload } = started.json<StartedUpload>();
    expect(file).toMatchObject({ status: "PENDING_UPLOAD", purpose: "PASSPORT_PHOTO" });
    expect(upload.url).toMatch(/X-Amz-Signature=/);

    // Nothing has arrived yet.
    const early = await t.request({
      method: "POST",
      url: `/api/v1/files/${file.id}/complete`,
      headers: p.applicant.headers,
    });
    expect(early.statusCode).toBe(400);

    // The signed length must match: a bigger body is refused by the bucket itself.
    const tooBig = await fetch(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: Buffer.concat([PHOTO, PHOTO]),
    });
    expect(tooBig.ok).toBe(false);

    const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: PHOTO });
    expect(put.status).toBe(200);
    // Only the uploader can complete it.
    const stranger = await t.request({
      method: "POST",
      url: `/api/v1/files/${file.id}/complete`,
      headers: p.noRole.headers,
    });
    expect(stranger.statusCode).toBe(404);
    const done = await t.request({
      method: "POST",
      url: `/api/v1/files/${file.id}/complete`,
      headers: p.applicant.headers,
    });
    expect(done.json()).toMatchObject({ status: "AVAILABLE", sizeBytes: PHOTO.length });
  });
});

describe("downloading a passport photo", () => {
  let photo: FileView;

  beforeAll(async () => {
    photo = await uploadPhoto(p.applicant.headers);
  });

  it("redirects the owner to a 5-minute download URL", async () => {
    const res = await t.request({ url: photo.downloadPath, headers: p.applicant.headers });
    expect(res.statusCode).toBe(302);
    const location = String(res.headers.location);
    expect(location).toMatch(/X-Amz-Expires=300/);
    const bytes = await fetch(location);
    expect(Buffer.from(await bytes.arrayBuffer()).equals(PHOTO)).toBe(true);
    expect(bytes.headers.get("content-disposition")).toBe('attachment; filename="me.png"');
  });

  const allowed = new Set<PersonaName>(["applicant", "sysAdmin", "admOfficer"]);
  it.each(Object.keys(PERSONA_SPECS) as PersonaName[])(
    "as %s: only the owner and admissions staff may fetch it",
    async (name) => {
      const res = await t.request({ url: photo.downloadPath, headers: p[name].headers });
      expect(res.statusCode).toBe(allowed.has(name) ? 302 : 404);
    },
  );

  it("needs a session", async () => {
    expect((await t.request({ url: photo.downloadPath })).statusCode).toBe(401);
  });
});
