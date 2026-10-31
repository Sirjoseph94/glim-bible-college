import type { GradingScheme, Programme } from "@glim/contracts";
import { GradingSchemesService } from "@glim/modules/results";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type PersonaName, type Personas } from "./personas";

/** Grading schemes (TRD §14.4, C-11, C-31, D-02): seeded, managed by the Registrar, locked once used. */

let t: TestApp;
let p: Personas;

interface ErrorBody {
  error: { code: string; fieldErrors?: { path: string }[] };
}

const send = (
  as: PersonaName,
  method: "GET" | "POST" | "PUT" | "PATCH",
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
const ifMatch = (v: number) => ({ "if-match": `"${String(v)}"` });

const list = async () =>
  (await send("registrar", "GET", "/grading-schemes")).json<{ items: GradingScheme[] }>().items;

const body = (s: GradingScheme, name: string) => ({
  name,
  kind: s.kind,
  bands: s.bands,
  classBands: s.classBands,
  minAwardCgpaX100: s.minAwardCgpaX100,
  maxPointsX100: s.maxPointsX100,
  passMarkX100: s.passMarkX100,
  repeatPolicy: s.repeatPolicy,
  goodStandingCgpaX100: s.goodStandingCgpaX100,
  probationCgpaX100: s.probationCgpaX100,
});

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
});

afterAll(async () => {
  await t.close();
});

describe("the seeded schemes", () => {
  it("GLIM Certificate and GLIM Diploma: NUC 5 bands, GLIM award classes, BEST, good standing 1.00", async () => {
    const items = await list();
    for (const name of ["GLIM Certificate", "GLIM Diploma"]) {
      const s = items.find((x) => x.name === name);
      expect(s, name).toMatchObject({
        kind: "NUC_5",
        passMarkX100: 4000,
        maxPointsX100: 500,
        minAwardCgpaX100: 100,
        repeatPolicy: "BEST",
        goodStandingCgpaX100: 100,
        probationCgpaX100: null,
        lockedAt: null,
      });
      expect(s?.bands.map((b) => [b.letter, b.minX100, b.maxX100, b.pointsX100])).toEqual([
        ["A", 7000, 10000, 500],
        ["B", 6000, 6999, 400],
        ["C", 5000, 5999, 300],
        ["D", 4500, 4999, 200],
        ["E", 4000, 4499, 100],
        ["F", 0, 3999, 0],
      ]);
      expect(s?.classBands).toEqual([
        { minCgpaX100: 450, maxCgpaX100: 500, label: "Distinction" },
        { minCgpaX100: 300, maxCgpaX100: 449, label: "Credit" },
        { minCgpaX100: 100, maxCgpaX100: 299, label: "Pass" },
      ]);
    }
  });

  it("is for the Registrar and System Admin only", async () => {
    expect((await send("acadAdmin", "GET", "/grading-schemes")).statusCode).toBe(403);
    expect((await send("l1Primary", "GET", "/grading-schemes")).statusCode).toBe(403);
    expect((await send("sysAdmin", "GET", "/grading-schemes")).statusCode).toBe(200);
  });
});

describe("managing schemes", () => {
  it("creates a scheme, refusing gaps in the bands and a taken name", async () => {
    const diploma = (await list()).find((s) => s.name === "GLIM Diploma");
    if (diploma === undefined) throw new Error("no seeded scheme");
    const res = await send(
      "registrar",
      "POST",
      "/grading-schemes",
      body(diploma, "Draft scheme"),
      key(),
    );
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<GradingScheme>()).toMatchObject({ name: "Draft scheme", supersedesId: null });

    const gap = body(diploma, "Gappy");
    gap.bands = gap.bands.map((b) => (b.letter === "C" ? { ...b, minX100: 5100 } : b));
    const refused = await send("registrar", "POST", "/grading-schemes", gap, key());
    expect(refused.statusCode).toBe(400);
    expect(refused.json<ErrorBody>().error.fieldErrors?.[0]?.path).toBe("body.bands");

    const taken = await send(
      "registrar",
      "POST",
      "/grading-schemes",
      body(diploma, "GLIM Diploma"),
      key(),
    );
    expect(taken.statusCode).toBe(409);
  });

  it("edits an unused scheme in place with If-Match", async () => {
    const draft = (await list()).find((s) => s.name === "Draft scheme");
    if (draft === undefined) throw new Error("no draft scheme");
    const stale = await send(
      "registrar",
      "PATCH",
      `/grading-schemes/${draft.id}`,
      { probationCgpaX100: 50 },
      ifMatch(draft.version + 1),
    );
    expect(stale.statusCode).toBe(412);
    const res = await send(
      "registrar",
      "PATCH",
      `/grading-schemes/${draft.id}`,
      { probationCgpaX100: 50, repeatPolicy: "KEEP_ALL" },
      ifMatch(draft.version),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<GradingScheme>()).toMatchObject({
      probationCgpaX100: 50,
      repeatPolicy: "KEEP_ALL",
    });
    // Probation must sit below good standing.
    const bad = await send(
      "registrar",
      "PATCH",
      `/grading-schemes/${draft.id}`,
      { classBands: [{ minCgpaX100: 100, maxCgpaX100: 400, label: "Pass" }] },
      ifMatch(res.json<GradingScheme>().version),
    );
    expect(bad.statusCode).toBe(400);
  });

  it("once used, a scheme is SCHEME_LOCKED; a new version takes its programmes", async () => {
    const programme = await send("acadAdmin", "POST", "/programmes", {
      code: "LOCKP",
      name: "Lock programme",
    });
    expect(programme.statusCode, programme.body).toBe(201);
    const programmeId = programme.json<Programme>().id;
    const diploma = (await list()).find((s) => s.name === "GLIM Diploma");
    if (diploma === undefined) throw new Error("no seeded scheme");
    const assigned = await send("registrar", "PUT", `/programmes/${programmeId}/grading-scheme`, {
      gradingSchemeId: diploma.id,
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(assigned.json<GradingScheme>().programmes.map((x) => x.code)).toContain("LOCKP");

    // The first finalized result locks it (ticket 38 calls this in its transaction).
    const service = t.app.get(GradingSchemesService);
    await t.db.withTx(({ db }) => service.lock(db, diploma.id));
    const locked = (await list()).find((s) => s.id === diploma.id);
    expect(locked?.lockedAt).not.toBeNull();
    const refused = await send(
      "registrar",
      "PATCH",
      `/grading-schemes/${diploma.id}`,
      { repeatPolicy: "KEEP_ALL" },
      ifMatch(locked?.version ?? 0),
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json<ErrorBody>().error.code).toBe("SCHEME_LOCKED");

    const next = await send(
      "registrar",
      "POST",
      "/grading-schemes",
      {
        ...body(diploma, "GLIM Diploma 2027"),
        repeatPolicy: "REPLACE_LATEST",
        supersedesId: diploma.id,
      },
      key(),
    );
    expect(next.statusCode, next.body).toBe(201);
    const v2 = next.json<GradingScheme>();
    expect(v2).toMatchObject({ supersedesId: diploma.id, lockedAt: null });
    expect(v2.programmes.map((x) => x.code)).toContain("LOCKP");
    const after = (await list()).find((s) => s.id === diploma.id);
    expect(after?.programmes.map((x) => x.code)).not.toContain("LOCKP");
    const programmes = (await send("registrar", "GET", "/programmes")).json<{
      items: Programme[];
    }>();
    expect(programmes.items.find((x) => x.id === programmeId)?.gradingSchemeId).toBe(v2.id);

    const audit = await t.db.pool.query<{ action: string }>(
      "SELECT action FROM audit_logs WHERE resource_type IN ('grading_scheme', 'programme') AND action LIKE 'results.scheme.%' ORDER BY created_at",
    );
    expect(audit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        "results.scheme.created",
        "results.scheme.assigned",
        "results.scheme.updated",
      ]),
    );
  });

  it("refuses an unknown scheme for a programme", async () => {
    const programmes = (await send("registrar", "GET", "/programmes")).json<{
      items: Programme[];
    }>();
    const res = await send(
      "registrar",
      "PUT",
      `/programmes/${programmes.items[0]?.id ?? ""}/grading-scheme`,
      { gradingSchemeId: "01900000-0000-7000-8000-000000000000" },
    );
    expect(res.statusCode).toBe(400);
  });
});
