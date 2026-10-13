import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "./secrets";

const key = Buffer.alloc(32, 9);

describe("sealSecret / openSecret", () => {
  it("round-trips, with a fresh nonce each time", () => {
    const a = sealSecret(key, "1//refresh-token");
    expect(a).not.toContain("refresh");
    expect(sealSecret(key, "1//refresh-token")).not.toBe(a);
    expect(openSecret(key, a)).toBe("1//refresh-token");
  });

  it("refuses the wrong key and tampering", () => {
    const sealed = sealSecret(key, "secret");
    expect(() => openSecret(Buffer.alloc(32, 1), sealed)).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("other").toString("base64url");
    expect(() => openSecret(key, parts.join("."))).toThrow();
    expect(() => openSecret(key, "plain")).toThrow();
  });
});
