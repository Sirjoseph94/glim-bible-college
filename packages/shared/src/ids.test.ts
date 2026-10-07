import { describe, expect, it } from "vitest";
import { isUuid, newId } from "./ids";

describe("newId", () => {
  it("returns a version 7 UUID", () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("returns ids that sort in creation order", () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("isUuid", () => {
  it("accepts any canonical UUID and rejects other strings", () => {
    expect(isUuid("0199b8a2-7c1e-7d3a-9f00-123456789abc")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("0199B8A2-7C1E-7D3A-9F00-123456789ABC")).toBe(false);
  });
});
