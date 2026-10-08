import type { Announcement, FileView, Material, UploadTarget } from "@glim/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, sessionFor, type PersonaName, type Personas } from "./personas";

/**
 * Course materials and announcements (TRD §14.1). O1 is taught by l1Primary (PRIMARY), l2Co and
 * l3Assistant (who may manage content) and taken by sEnrolled; sCompleted finished it while still
 * studying; sGraduated has graduated; sOther takes O2.
 */

let t: TestApp;
let p: Personas;

const MB = 1024 * 1024;
const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

const send = (
  as: PersonaName,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  t.request({
    method,
    url: `/api/v1${url}`,
    headers: { ...p[as].headers, ...headers },
    ...(payload === undefined ? {} : { payload }),
  });

const addMaterial = (as: PersonaName, payload: Record<string, unknown>) =>
  send(as, "POST", `/course-offerings/${p.world.offerings.O1}/materials`, payload, {
    "idempotency-key": idempotencyKey(),
  });

const titles = async (as: PersonaName) =>
  (await send(as, "GET", `/course-offerings/${p.world.offerings.O1}/materials`))
    .json<{ items: Material[] }>()
    .items.map((m) => m.title);

interface Started {
  file: FileView;
  upload: UploadTarget;
}

async function startMaterialUpload(as: PersonaName, sizeBytes: number, mime = "application/pdf") {
  return send(as, "POST", "/files/uploads", {
    name: "notes.pdf",
    mime,
    sizeBytes,
    purpose: "MATERIAL",
  });
}

/** A small PDF uploaded as the given persona, ready to attach. */
async function smallPdf(as: PersonaName): Promise<string> {
  const bytes = Buffer.from("%PDF-1.4 pretend lecture notes");
  const started = (await startMaterialUpload(as, bytes.length)).json<Started>();
  if (started.upload.method !== "PUT") throw new Error("expected a single PUT");
  const put = await fetch(started.upload.url, {
    method: "PUT",
    headers: started.upload.headers,
    body: bytes,
  });
  expect(put.status).toBe(200);
  expect((await send(as, "POST", `/files/${started.file.id}/complete`)).statusCode).toBe(200);
  return started.file.id;
}

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
});

afterAll(async () => {
  await t.close();
});

describe("materials", () => {
  it("adds a link, a text and a file, in order", async () => {
    const link = await addMaterial("l1Primary", {
      kind: "LINK",
      title: "Reading: John 1",
      url: "https://www.biblegateway.com/passage/?search=John+1",
      sectionLabel: "Week 1",
    });
    expect(link.statusCode, link.body).toBe(201);
    expect(link.json<Material>()).toMatchObject({ kind: "LINK", position: 0, status: "PUBLISHED" });

    const text = await addMaterial("l3Assistant", {
      kind: "TEXT",
      title: "Study questions",
      bodyMd: "1. **Who** is the Word?\n\n<script>alert(1)</script>",
      sectionLabel: "Week 1",
    });
    expect(text.statusCode, text.body).toBe(201);
    const body = text.json<Material>();
    expect(body.bodyHtml).toContain("<strong>Who</strong>");
    expect(body.bodyHtml).not.toContain("<script");
    expect(body.position).toBe(1);

    const file = await addMaterial("l2Co", {
      kind: "FILE",
      title: "Lecture notes",
      fileId: await smallPdf("l2Co"),
    });
    expect(file.statusCode, file.body).toBe(201);
    expect(file.json<Material>().file).toMatchObject({
      name: "notes.pdf",
      mime: "application/pdf",
    });
  });

  it("refuses a file that isn't the adder's own finished upload, and a non-web link", async () => {
    const others = await addMaterial("l1Primary", {
      kind: "FILE",
      title: "Not mine",
      fileId: await smallPdf("l2Co"),
    });
    expect(others.statusCode).toBe(400);
    const js = await addMaterial("l1Primary", {
      kind: "LINK",
      title: "Bad",
      url: "javascript:alert(1)",
    });
    expect(js.statusCode).toBe(400);
  });

  it("shows students only published, released, enrolled-visibility materials", async () => {
    await addMaterial("l1Primary", { kind: "TEXT", title: "Draft", bodyMd: "x", status: "DRAFT" });
    await addMaterial("l1Primary", {
      kind: "TEXT",
      title: "Staff notes",
      bodyMd: "x",
      visibility: "STAFF_ONLY",
    });
    await addMaterial("l1Primary", {
      kind: "TEXT",
      title: "Next week",
      bodyMd: "x",
      publishAt: new Date(t.clock.now().getTime() + 86_400_000).toISOString(),
    });
    const visible = ["Lecture notes", "Reading: John 1", "Study questions"];
    expect((await titles("sEnrolled")).sort()).toEqual(visible);
    // A student who completed the course keeps read access while studying.
    expect((await titles("sCompleted")).sort()).toEqual(visible);
    expect(await titles("l1Primary")).toHaveLength(6);

    t.clock.advance({ days: 1, minutes: 1 });
    for (const name of Object.keys(p).filter((k) => k !== "world") as PersonaName[])
      p[name].headers = await sessionFor(t, p[name].userId);
    expect(await titles("sEnrolled")).toContain("Next week");
  });

  it("hides them from people not entitled", async () => {
    for (const who of ["sGraduated", "sOther", "applicant", "noRole", "l4Other"] as const)
      expect(
        (await send(who, "GET", `/course-offerings/${p.world.offerings.O1}/materials`)).statusCode,
        who,
      ).toBe(404);
    for (const who of ["sEnrolled", "registrar", "l4Other"] as const)
      expect([403, 404], who).toContain(
        (await addMaterial(who, { kind: "TEXT", title: "x", bodyMd: "x" })).statusCode,
      );
  });

  it("downloads a file material through a short-lived link, for those who may see it", async () => {
    const items = (
      await send("sEnrolled", "GET", `/course-offerings/${p.world.offerings.O1}/materials`)
    ).json<{ items: Material[] }>().items;
    const notes = items.find((m) => m.kind === "FILE");
    if (notes?.file == null) throw new Error("no file material");
    const res = await send("sEnrolled", "GET", `/course-materials/${notes.id}/download`);
    expect(res.statusCode).toBe(302);
    const fetched = await fetch(String(res.headers.location));
    expect(await fetched.text()).toBe("%PDF-1.4 pretend lecture notes");
    expect((await send("sOther", "GET", `/course-materials/${notes.id}/download`)).statusCode).toBe(
      404,
    );
    // The file itself isn't readable through the generic file route.
    expect((await send("sEnrolled", "GET", `/files/${notes.file.id}/download`)).statusCode).toBe(
      404,
    );
  });

  it("edits with If-Match, and deleting archives it", async () => {
    const items = (
      await send("l1Primary", "GET", `/course-offerings/${p.world.offerings.O1}/materials`)
    ).json<{ items: Material[] }>().items;
    const text = items.find((m) => m.title === "Study questions");
    if (text === undefined) throw new Error("missing");
    const patched = await send(
      "l1Primary",
      "PATCH",
      `/course-materials/${text.id}`,
      { bodyMd: "Read *John 1:1*", position: 9, sectionLabel: "Week 2" },
      { "if-match": `"${String(text.version)}"` },
    );
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json<Material>()).toMatchObject({ position: 9, sectionLabel: "Week 2" });
    expect(patched.json<Material>().bodyHtml).toContain("<em>John 1:1</em>");
    const stale = await send(
      "l1Primary",
      "PATCH",
      `/course-materials/${text.id}`,
      { title: "x" },
      { "if-match": `"${String(text.version)}"` },
    );
    expect(stale.statusCode).toBe(412);
    const wrongKind = await send(
      "l1Primary",
      "PATCH",
      `/course-materials/${text.id}`,
      { url: "https://example.org" },
      { "if-match": `"${String(text.version + 1)}"` },
    );
    expect(wrongKind.statusCode).toBe(400);

    expect((await send("l1Primary", "DELETE", `/course-materials/${text.id}`)).statusCode).toBe(
      204,
    );
    expect(await titles("l1Primary")).not.toContain("Study questions");
    expect((await send("l1Primary", "DELETE", `/course-materials/${text.id}`)).statusCode).toBe(
      404,
    );
  });
});

describe("material uploads", () => {
  it("caps materials at 100 MB and to document, image and audio types", async () => {
    expect((await startMaterialUpload("l1Primary", 100 * MB + 1)).statusCode).toBe(400);
    expect((await startMaterialUpload("l1Primary", MB, "video/mp4")).statusCode).toBe(400);
    expect((await startMaterialUpload("l1Primary", 100 * MB)).statusCode).toBe(201);
  });

  it("sends files above 8 MB in parts and resumes an interrupted upload", async () => {
    const size = 9 * MB + 123;
    const bytes = Buffer.alloc(size, 7);
    const started = (await startMaterialUpload("l1Primary", size)).json<Started>();
    if (started.upload.method !== "MULTIPART") throw new Error("expected parts");
    expect(started.upload.parts.map((x) => x.partNumber)).toEqual([1, 2]);
    expect(started.upload.uploadedPartNumbers).toEqual([]);
    const partSize = started.upload.partSizeBytes;

    // Part 1 arrives, then the connection drops.
    const first = await fetch(started.upload.parts[0]?.url ?? "", {
      method: "PUT",
      body: bytes.subarray(0, partSize),
    });
    expect(first.status).toBe(200);
    const early = await send("l1Primary", "POST", `/files/${started.file.id}/complete`);
    expect(early.statusCode).toBe(400);

    const resumed = await send("l1Primary", "POST", `/files/${started.file.id}/resume`);
    expect(resumed.statusCode, resumed.body).toBe(200);
    const target = resumed.json<UploadTarget & { method: "MULTIPART" }>();
    expect(target.uploadedPartNumbers).toEqual([1]);
    const second = await fetch(target.parts[1]?.url ?? "", {
      method: "PUT",
      body: bytes.subarray(partSize),
    });
    expect(second.status).toBe(200);

    const done = await send("l1Primary", "POST", `/files/${started.file.id}/complete`);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json<FileView>()).toMatchObject({ status: "AVAILABLE", sizeBytes: size });
    expect((await send("l1Primary", "POST", `/files/${started.file.id}/resume`)).statusCode).toBe(
      404,
    );
    expect((await send("l2Co", "POST", `/files/${started.file.id}/resume`)).statusCode).toBe(404);
  });
});

describe("announcements", () => {
  it("posts one and tells the course's enrolled students in the app", async () => {
    const res = await send(
      "l3Assistant",
      "POST",
      `/course-offerings/${p.world.offerings.O1}/announcements`,
      { title: "No class on Friday", bodyMd: "We meet **Monday** instead." },
      { "idempotency-key": idempotencyKey() },
    );
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<Announcement>()).toMatchObject({
      title: "No class on Friday",
      pinned: false,
      bodyHtml: "<p>We meet <strong>Monday</strong> instead.</p>",
    });
    const notices = await q<{ user_id: string; email_status: string }>(
      "SELECT user_id, email_status FROM notifications WHERE kind = 'content.announcement'",
    );
    expect(notices.rows).toEqual([{ user_id: p.sEnrolled.userId, email_status: "NOT_REQUESTED" }]);
  });

  it("lists pinned ones first, then newest, for everyone on the course", async () => {
    const pinned = await send(
      "l1Primary",
      "POST",
      `/course-offerings/${p.world.offerings.O1}/announcements`,
      { title: "Course outline", bodyMd: "See materials.", pinned: true },
      { "idempotency-key": idempotencyKey() },
    );
    t.clock.advance({ minutes: 1 });
    await send(
      "l1Primary",
      "POST",
      `/course-offerings/${p.world.offerings.O1}/announcements`,
      { title: "Essay due", bodyMd: "Friday." },
      { "idempotency-key": idempotencyKey() },
    );
    const list = await send(
      "sCompleted",
      "GET",
      `/course-offerings/${p.world.offerings.O1}/announcements`,
    );
    expect(list.json<{ items: Announcement[] }>().items.map((a) => a.title)).toEqual([
      "Course outline",
      "Essay due",
      "No class on Friday",
    ]);
    expect(
      (await send("sOther", "GET", `/course-offerings/${p.world.offerings.O1}/announcements`))
        .statusCode,
    ).toBe(404);

    const a = pinned.json<Announcement>();
    const unpinned = await send(
      "l2Co",
      "PATCH",
      `/announcements/${a.id}`,
      { pinned: false },
      { "if-match": `"${String(a.version)}"` },
    );
    expect(unpinned.json<Announcement>().pinned).toBe(false);
    expect((await send("sEnrolled", "DELETE", `/announcements/${a.id}`)).statusCode).toBe(404);
    expect((await send("l2Co", "DELETE", `/announcements/${a.id}`)).statusCode).toBe(204);
  });
});
