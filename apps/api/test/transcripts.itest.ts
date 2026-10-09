import type { GradebookColumn, Transcript, TranscriptRequest, Verification } from "@glim/contracts";
import { snapshotSha256 } from "@glim/modules/transcripts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type PersonaName, type Personas } from "./personas";

/**
 * Transcripts (TRD §14.7, AC-14). sEnrolled's O1 result (PBIB101, 80 ⇒ A) is finalized; its
 * semester isn't approved until the official transcript test approves and publishes it.
 */

let t: TestApp;
let p: Personas;
let enrollmentId = "";

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

interface ErrorBody {
  error: { code: string; message: string };
}

const send = (
  as: PersonaName,
  method: "GET" | "POST",
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

const key = () => ({ "idempotency-key": idempotencyKey() });
const ask = (payload: unknown, as: PersonaName = "sEnrolled", id = enrollmentId) =>
  send(as, "POST", `/programme-enrollments/${id}/transcript-requests`, payload);
const official = {
  kind: "OFFICIAL",
  purpose: "Admission to a seminary",
  recipientName: "Registrar, Lagos Seminary",
  recipientEmail: "registrar@seminary.test",
};

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
  await q(
    "UPDATE programmes SET grading_scheme_id = (SELECT id FROM grading_schemes WHERE name = 'GLIM Diploma') WHERE code = 'PDIP'",
  );
  const { rows } = await q<{ id: string; student: string }>(
    `SELECT pe.id, s.id AS student FROM programme_enrollments pe JOIN students s ON s.id = pe.student_id
      WHERE s.user_id = $1`,
    [p.sEnrolled.userId],
  );
  enrollmentId = rows[0]?.id ?? "";
  const col = (
    await send(
      "l1Primary",
      "POST",
      `/course-offerings/${p.world.offerings.O1}/assessments`,
      { title: "Everything", maxScore: "100", weight: "100" },
      key(),
    )
  ).json<GradebookColumn>();
  await t.request({
    method: "PUT",
    url: `/api/v1/assessments/${col.assessmentId}/grades/${rows[0]?.student ?? ""}`,
    headers: { ...p.l1Primary.headers, "if-match": '"0"' },
    payload: { score: "80" },
  });
  const fin = await send(
    "l1Primary",
    "POST",
    `/course-offerings/${p.world.offerings.O1}/results/finalize`,
    undefined,
    key(),
  );
  expect(fin.statusCode, fin.body).toBe(200);
});

afterAll(async () => {
  await t.close();
});

describe("unofficial transcripts", () => {
  let first: TranscriptRequest;

  it("are issued at once, with a snapshot, its SHA-256, a serial and a verification code", async () => {
    const res = await ask({ kind: "UNOFFICIAL" });
    expect(res.statusCode, res.body).toBe(201);
    first = res.json<TranscriptRequest>();
    expect(first).toMatchObject({ kind: "UNOFFICIAL", status: "ISSUED" });
    expect(first.transcript).toMatchObject({
      kind: "UNOFFICIAL",
      serialNo: "GLIM/TR/2026/00001",
      status: "ISSUED",
      asOf: "2026-11-02",
    });

    const doc = (
      await send("sEnrolled", "GET", `/transcripts/${first.transcript?.id ?? ""}`)
    ).json<Transcript>();
    expect(doc.verificationCode).toMatch(/^[A-Z2-7]{16}$/);
    expect(doc.snapshotSha256).toBe(snapshotSha256(doc.snapshot));
    expect(doc.snapshot).toMatchObject({
      version: 1,
      kind: "UNOFFICIAL",
      asOf: "2026-11-02",
      programme: { code: "PDIP", name: "Persona Diploma", awardType: "DIPLOMA" },
      student: { legalName: "sEnrolled Persona" },
      totals: { creditsAttemptedX10: 30, creditsEarnedX10: 30, cgpaX100: 500, standing: "GOOD" },
      award: null,
    });
    expect(doc.snapshot.student.matricNumber).toMatch(/^GLIM\/PDIP\//);
    expect(doc.snapshot.semesters).toHaveLength(1);
    expect(doc.snapshot.semesters[0]).toMatchObject({
      provisional: true,
      gpaX100: 500,
      courses: [{ code: "PBIB101", letter: "A", finalPctX100: 8000, repeated: false }],
    });
    expect(doc.snapshot.legend.bands).toHaveLength(6);
    // The stored hash is of the stored snapshot, byte for byte.
    const stored = await q<{ snapshot: unknown; snapshot_sha256: string }>(
      "SELECT snapshot, snapshot_sha256 FROM transcripts WHERE id = $1",
      [doc.id],
    );
    expect(snapshotSha256(stored.rows[0]?.snapshot)).toBe(stored.rows[0]?.snapshot_sha256);
    const audit = await q(
      "SELECT 1 FROM audit_logs WHERE action = 'transcript.issued' AND resource_id = $1",
      [doc.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("are limited to 5 a day", async () => {
    for (let i = 0; i < 4; i++) expect((await ask({ kind: "UNOFFICIAL" })).statusCode).toBe(201);
    const sixth = await ask({ kind: "UNOFFICIAL" });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json<ErrorBody>().error.code).toBe("RATE_LIMITED");
    // Serials run on without gaps.
    const serials = await q<{ serial_no: string }>(
      "SELECT serial_no FROM transcripts ORDER BY serial_no",
    );
    expect(serials.rows.map((r) => r.serial_no)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `GLIM/TR/2026/0000${String(n)}`),
    );
  });

  it("are only for the student whose enrollment it is", async () => {
    expect((await ask({ kind: "UNOFFICIAL" }, "sOther")).statusCode).toBe(404);
    expect((await ask({ kind: "UNOFFICIAL" }, "registrar")).statusCode).toBe(404);
    expect(
      (await send("sOther", "GET", `/transcripts/${first.transcript?.id ?? ""}`)).statusCode,
    ).toBe(404);
    expect(
      (await send("registrar", "GET", `/transcripts/${first.transcript?.id ?? ""}`)).statusCode,
    ).toBe(200);
  });
});

describe("official transcripts", () => {
  it("need a purpose and recipient, the Registrar's approval and approved semesters", async () => {
    expect((await ask({ kind: "OFFICIAL" })).statusCode).toBe(400);
    const res = await ask(official);
    expect(res.statusCode, res.body).toBe(201);
    const request = res.json<TranscriptRequest>();
    expect(request).toMatchObject({ status: "REQUESTED", transcript: null });
    const queue = (await send("registrar", "GET", "/transcript-requests?status=REQUESTED")).json<{
      items: TranscriptRequest[];
    }>();
    expect(queue.items.map((x) => x.id)).toEqual([request.id]);

    const early = await send(
      "registrar",
      "POST",
      `/transcript-requests/${request.id}/issue`,
      undefined,
      key(),
    );
    expect(early.statusCode).toBe(409);
    expect(
      (
        await send("registrar", "POST", `/transcript-requests/${request.id}/approve`)
      ).json<TranscriptRequest>().status,
    ).toBe("APPROVED");
    const notYet = await send(
      "registrar",
      "POST",
      `/transcript-requests/${request.id}/issue`,
      undefined,
      key(),
    );
    expect(notYet.statusCode).toBe(422);
    expect(notYet.json<ErrorBody>().error.code).toBe("TRANSCRIPT_NOT_ISSUABLE");

    for (const step of ["compute", "approve"])
      expect(
        (
          await send(
            "registrar",
            "POST",
            `/results/semesters/${step}`,
            { semesterId: p.world.semesterId },
            key(),
          )
        ).statusCode,
      ).toBe(200);
    const issued = await send(
      "registrar",
      "POST",
      `/transcript-requests/${request.id}/issue`,
      undefined,
      key(),
    );
    expect(issued.statusCode, issued.body).toBe(200);
    const done = issued.json<TranscriptRequest>();
    expect(done).toMatchObject({ status: "ISSUED", transcript: { kind: "OFFICIAL" } });
    const doc = (
      await send("sEnrolled", "GET", `/transcripts/${done.transcript?.id ?? ""}`)
    ).json<Transcript>();
    expect(doc.snapshot.semesters[0]?.provisional).toBe(false);
    // Issuing again returns the same transcript.
    const again = await send(
      "registrar",
      "POST",
      `/transcript-requests/${request.id}/issue`,
      undefined,
      key(),
    );
    expect(again.json<TranscriptRequest>().transcript?.id).toBe(done.transcript?.id);
    // The student is emailed about an official transcript.
    const notices = await q<{ email_status: string }>(
      "SELECT email_status FROM notifications WHERE kind = 'transcript.issued' AND data->>'kind' = 'OFFICIAL'",
    );
    expect(notices.rows.map((n) => n.email_status)).toEqual(["PENDING"]);
  });

  it("can be rejected with a reason the student sees", async () => {
    const request = (await ask(official)).json<TranscriptRequest>();
    const res = await send("registrar", "POST", `/transcript-requests/${request.id}/reject`, {
      reason: "Fees outstanding",
    });
    expect(res.json<TranscriptRequest>()).toMatchObject({
      status: "REJECTED",
      decisionReason: "Fees outstanding",
    });
    const mine = (await send("sEnrolled", "GET", "/me/transcripts")).json<{
      items: TranscriptRequest[];
    }>();
    expect(mine.items.find((x) => x.id === request.id)?.decisionReason).toBe("Fees outstanding");
    expect(
      (await send("registrar", "POST", `/transcript-requests/${request.id}/approve`)).statusCode,
    ).toBe(409);
    expect((await send("acadAdmin", "GET", "/transcript-requests")).statusCode).toBe(403);
  });
});

describe("integrity", () => {
  it("lets only the status change, and never deletes a transcript", async () => {
    const { rows } = await q<{ id: string }>(
      "SELECT id FROM transcripts WHERE kind = 'UNOFFICIAL' LIMIT 1",
    );
    const id = rows[0]?.id ?? "";
    await expect(
      q(`UPDATE transcripts SET snapshot = '{"version":1}' WHERE id = $1`, [id]),
    ).rejects.toThrow(/can't change/);
    await expect(q("UPDATE transcripts SET serial_no = 'X' WHERE id = $1", [id])).rejects.toThrow();
    await expect(q("DELETE FROM transcripts WHERE id = $1", [id])).rejects.toThrow(/never deleted/);
    await q("UPDATE transcripts SET status = 'REVOKED', revoke_reason = 'test' WHERE id = $1", [
      id,
    ]);
    const after = await q<{ status: string }>("SELECT status FROM transcripts WHERE id = $1", [id]);
    expect(after.rows[0]?.status).toBe("REVOKED");
  });
});

describe("public verification", () => {
  it("shows only minimal fields, to anyone, by code", async () => {
    const { rows } = await q<{ verification_code: string; snapshot_sha256: string }>(
      "SELECT verification_code, snapshot_sha256 FROM transcripts WHERE kind = 'OFFICIAL'",
    );
    const code = rows[0]?.verification_code ?? "";
    const res = await t.request({ url: `/api/v1/public/transcripts/${code.toLowerCase()}` });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<Verification>();
    expect(Object.keys(body).sort()).toEqual([
      "asOf",
      "institutionName",
      "issuedAt",
      "programmeName",
      "snapshotSha256",
      "status",
      "studentInitials",
      "valid",
    ]);
    expect(body).toMatchObject({
      valid: true,
      status: "ISSUED",
      programmeName: "Persona Diploma",
      studentInitials: "S. P.",
      asOf: "2026-11-02",
      snapshotSha256: rows[0]?.snapshot_sha256,
    });
    expect(res.body).not.toContain("8000");
    // A revoked one is shown as not valid.
    const revoked = await q<{ verification_code: string }>(
      "SELECT verification_code FROM transcripts WHERE status = 'REVOKED'",
    );
    const r = await t.request({
      url: `/api/v1/public/transcripts/${revoked.rows[0]?.verification_code ?? ""}`,
    });
    expect(r.json<Verification>()).toMatchObject({ valid: false, status: "REVOKED" });
    expect(
      (await t.request({ url: "/api/v1/public/transcripts/AAAAAAAAAAAAAAAA" })).statusCode,
    ).toBe(404);
    expect((await t.request({ url: "/api/v1/public/transcripts/not-a-code" })).statusCode).toBe(
      400,
    );
  });

  it("is rate-limited to 30 a minute per client IP", async () => {
    const check = () =>
      t.request({
        url: "/api/v1/public/transcripts/AAAAAAAAAAAAAAAA",
        remoteAddress: "192.0.2.77",
      });
    for (let i = 0; i < 30; i++) expect((await check()).statusCode).toBe(404);
    expect((await check()).statusCode).toBe(429);
  });
});

describe("graduates", () => {
  it("keep their own transcripts", async () => {
    await q("UPDATE students SET status = 'GRADUATED' WHERE user_id = $1", [p.sEnrolled.userId]);
    try {
      const { rows } = await q<{ id: string }>(
        "SELECT id FROM transcripts WHERE kind = 'OFFICIAL'",
      );
      expect((await send("sEnrolled", "GET", `/transcripts/${rows[0]?.id ?? ""}`)).statusCode).toBe(
        200,
      );
      const me = (await send("sEnrolled", "GET", "/me")).json<{
        roles: { isStudent: boolean; isAlumnus: boolean };
      }>();
      expect(me.roles).toMatchObject({ isStudent: false, isAlumnus: true });
    } finally {
      await q("UPDATE students SET status = 'ACTIVE' WHERE user_id = $1", [p.sEnrolled.userId]);
    }
  });
});
