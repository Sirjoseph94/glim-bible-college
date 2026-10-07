import { describe, expect, it } from "vitest";
import { pageQuery } from "./pagination";

describe("pageQuery", () => {
  it("defaults the limit to 25 and caps it at 100", () => {
    expect(pageQuery.parse({})).toEqual({ limit: 25 });
    expect(pageQuery.parse({ limit: "100", cursor: "abc" })).toEqual({ limit: 100, cursor: "abc" });
    expect(pageQuery.safeParse({ limit: "101" }).success).toBe(false);
    expect(pageQuery.safeParse({ limit: "0" }).success).toBe(false);
  });
});
