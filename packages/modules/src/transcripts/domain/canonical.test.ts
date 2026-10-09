import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalJson, snapshotSha256, verificationCode } from "./canonical";

describe("canonicalJson", () => {
  it("sorts keys at every level and drops whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it("keeps arrays in order and escapes strings, including tonal marks", () => {
    expect(canonicalJson(["Ọ̀kọ́", 'a"b', null, true])).toBe('["Ọ̀kọ́","a\\"b",null,true]');
  });

  it("refuses values JSON can't hold exactly", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(() => canonicalJson([undefined])).toThrow();
  });

  it("gives the same text whatever order keys were added in (property)", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse());
        expect(canonicalJson(reversed)).toBe(canonicalJson(obj));
      }),
    );
  });
});

describe("snapshotSha256", () => {
  const snapshot = {
    student: { legalName: "Ada Okafor", matricNumber: "GLIM/DIP/2025/0012" },
    semesters: [{ gpaX100: 290, courses: [{ code: "DIP101", letter: "A" }] }],
    asOf: "2027-07-01",
  };

  it("is stable for identical input, in any key order", () => {
    const shuffled = {
      asOf: snapshot.asOf,
      semesters: snapshot.semesters,
      student: snapshot.student,
    };
    expect(snapshotSha256(shuffled)).toBe(snapshotSha256(snapshot));
    expect(snapshotSha256(snapshot)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any field changes", () => {
    const base = snapshotSha256(snapshot);
    expect(snapshotSha256({ ...snapshot, asOf: "2027-07-02" })).not.toBe(base);
    expect(
      snapshotSha256({
        ...snapshot,
        semesters: [{ gpaX100: 291, courses: [{ code: "DIP101", letter: "A" }] }],
      }),
    ).not.toBe(base);
    expect(
      snapshotSha256({ ...snapshot, student: { ...snapshot.student, matricNumber: "X" } }),
    ).not.toBe(base);
  });
});

describe("verificationCode", () => {
  it("is 16 base32 characters", () => {
    expect(verificationCode()).toMatch(/^[A-Z2-7]{16}$/);
    expect(verificationCode(new Uint8Array(10))).toBe("AAAAAAAAAAAAAAAA");
    expect(verificationCode(new Uint8Array(10).fill(255))).toBe("7777777777777777");
  });

  it("refuses the wrong number of bytes", () => {
    expect(() => verificationCode(new Uint8Array(9))).toThrow();
  });
});
