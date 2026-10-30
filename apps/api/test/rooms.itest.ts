import type { Room } from "@glim/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type Persona, type PersonaName } from "./personas";

let t: TestApp;
let p: Record<PersonaName, Persona>;

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
});

afterAll(async () => {
  await t.close();
});

const acad = () => p.acadAdmin.headers;

function post(url: string, payload?: unknown) {
  return t.request({ method: "POST", url, payload, headers: acad() });
}

describe("Rooms", () => {
  it("are created, resized and archived", async () => {
    const hall = (
      await post("/api/v1/rooms", { code: "R1", name: "Main Hall", capacity: 40 })
    ).json<Room>();
    expect(hall).toMatchObject({ code: "R1", capacity: 40, status: "ACTIVE" });
    expect((await post("/api/v1/rooms", { code: "r1", name: "Duplicate" })).statusCode).toBe(409);

    const archived = await t.request({
      method: "PATCH",
      url: `/api/v1/rooms/${hall.id}`,
      headers: { ...acad(), "if-match": '"1"' },
      payload: { capacity: null, status: "ARCHIVED" },
    });
    expect(archived.json()).toMatchObject({ capacity: null, status: "ARCHIVED", version: 2 });

    const list = await t.request({ url: "/api/v1/rooms", headers: p.admOfficer.headers });
    expect(list.json<{ items: Room[] }>().items.map((r) => r.code)).toEqual(["R1"]);
  });
});
