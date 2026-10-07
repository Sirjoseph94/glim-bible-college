import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, toPage } from "./pagination";
import { AppError } from "./result";

describe("cursors", () => {
  it("round-trip the sort key and id as an opaque base64url string", () => {
    const cursor = encodeCursor({
      sortKey: "2026-11-02T10:00:00.000Z",
      id: "0199b8a2-7c1e-7d3a-9f00-123456789abc",
    });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual({
      sortKey: "2026-11-02T10:00:00.000Z",
      id: "0199b8a2-7c1e-7d3a-9f00-123456789abc",
    });
  });

  it("reject a tampered cursor with VALIDATION_FAILED", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrow(AppError);
    expect(() => decodeCursor(Buffer.from('{"sortKey":1}').toString("base64url"))).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
  });
});

describe("toPage", () => {
  const rows = [
    { id: "a", name: "Ada" },
    { id: "b", name: "Bola" },
    { id: "c", name: "Chi" },
  ];

  it("returns a next cursor pointing at the last item when more rows exist", () => {
    const page = toPage(rows, 2, (r) => r.name);
    expect(page.items.map((r) => r.id)).toEqual(["a", "b"]);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor ?? "")).toEqual({ sortKey: "Bola", id: "b" });
  });

  it("returns no cursor on the last page", () => {
    expect(toPage(rows, 3, (r) => r.name)).toEqual({ items: rows, nextCursor: null });
  });
});
