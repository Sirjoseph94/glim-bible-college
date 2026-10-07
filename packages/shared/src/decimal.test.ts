import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { divRoundHalfUp, formatDecimal, mulDivRoundHalfUp, parseDecimal } from "./decimal";

describe("parseDecimal", () => {
  it("turns decimal text into an integer at the given scale", () => {
    expect(parseDecimal("73.5", 2)).toBe(7350);
    expect(parseDecimal("73.45", 2)).toBe(7345);
    expect(parseDecimal("100", 2)).toBe(10000);
    expect(parseDecimal("0.05", 2)).toBe(5);
    expect(parseDecimal("3.0", 1)).toBe(30);
    expect(parseDecimal("-2.5", 1)).toBe(-25);
  });

  it("rejects text with more decimal places than the scale, or that isn't a number", () => {
    for (const bad of ["73.456", "", "1e3", "12,5", "abc", ".5", "5.", "--1", "0x10"]) {
      expect(() => parseDecimal(bad, 2), bad).toThrow();
    }
  });
});

describe("formatDecimal", () => {
  it("renders a scaled integer with exactly `scale` decimals", () => {
    expect(formatDecimal(7350, 2)).toBe("73.50");
    expect(formatDecimal(5, 2)).toBe("0.05");
    expect(formatDecimal(-25, 1)).toBe("-2.5");
    expect(formatDecimal(-5, 2)).toBe("-0.05");
    expect(formatDecimal(449, 2)).toBe("4.49");
    expect(formatDecimal(30, 0)).toBe("30");
  });

  it("round-trips with parseDecimal", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc.integer({ min: 0, max: 4 }),
        (n, scale) => {
          expect(parseDecimal(formatDecimal(n, scale), scale)).toBe(n);
        },
      ),
    );
  });
});

describe("divRoundHalfUp", () => {
  it("rounds exact halves away from zero and everything else to the nearest integer", () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(7, 2)).toBe(4);
    expect(divRoundHalfUp(1, 3)).toBe(0);
    expect(divRoundHalfUp(2, 3)).toBe(1);
    expect(divRoundHalfUp(44_949, 100)).toBe(449);
    expect(divRoundHalfUp(44_950, 100)).toBe(450);
    expect(divRoundHalfUp(-5, 2)).toBe(-3);
    expect(divRoundHalfUp(0, 7)).toBe(0);
  });

  it("is never more than half a unit away from the exact quotient, and ties go up", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e12 }), fc.integer({ min: 1, max: 1e6 }), (n, d) => {
        const q = divRoundHalfUp(n, d);
        const twiceRemainder = 2 * (n - q * d);
        expect(twiceRemainder).toBeLessThan(d);
        expect(twiceRemainder).toBeGreaterThanOrEqual(-d);
      }),
    );
  });

  it("refuses to divide by zero", () => {
    expect(() => divRoundHalfUp(1, 0)).toThrow();
  });
});

describe("mulDivRoundHalfUp", () => {
  it("computes a × b ÷ c exactly before rounding, even beyond 2^53 intermediates", () => {
    // 37/40 of a 30-point component: 27.75 → 2775 hundredths
    expect(mulDivRoundHalfUp(37 * 100, 3000, 4000)).toBe(2775);
    expect(mulDivRoundHalfUp(9_007_199_254_740_991, 3, 3)).toBe(9_007_199_254_740_991);
  });
});
