/**
 * Exact decimal helpers (INV-14, TRD §5.1). Academic values are carried as integers at a fixed
 * scale (scores in hundredths, credits in tenths, grade points in hundredths, ratios in basis
 * points) and never as JS floats.
 */

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Parses decimal text into an integer at `scale` decimal places, e.g. ("73.5", 2) → 7350. */
export function parseDecimal(text: string, scale: number): number {
  const match = DECIMAL.exec(text);
  if (!match) throw new RangeError(`Not a decimal number: "${text}"`);
  const [, sign = "", whole = "", fraction = ""] = match;
  if (fraction.length > scale) {
    throw new RangeError(`"${text}" has more than ${scale} decimal places`);
  }
  const digits = BigInt(whole + fraction.padEnd(scale, "0"));
  return toSafeNumber(sign === "-" ? -digits : digits);
}

/** Renders an integer at `scale` decimal places, e.g. (7350, 2) → "73.50". */
export function formatDecimal(scaled: number, scale: number): string {
  assertInteger(scaled);
  const negative = scaled < 0;
  const digits = Math.abs(scaled)
    .toString()
    .padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? "-" : ""}${whole}${scale > 0 ? `.${fraction}` : ""}`;
}

/** n ÷ d rounded half-up (exact halves away from zero). */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  assertInteger(numerator);
  assertInteger(denominator);
  return toSafeNumber(bigDivRoundHalfUp(BigInt(numerator), BigInt(denominator)));
}

/** a × b ÷ c computed exactly, then rounded half-up. */
export function mulDivRoundHalfUp(a: number, b: number, c: number): number {
  assertInteger(a);
  assertInteger(b);
  assertInteger(c);
  return toSafeNumber(bigDivRoundHalfUp(BigInt(a) * BigInt(b), BigInt(c)));
}

function bigDivRoundHalfUp(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError("Division by zero");
  const negative = n < 0n !== d < 0n;
  const absN = n < 0n ? -n : n;
  const absD = d < 0n ? -d : d;
  const q = (2n * absN + absD) / (2n * absD);
  return negative ? -q : q;
}

function assertInteger(n: number): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Expected a safe integer, got ${n}`);
}

function toSafeNumber(n: bigint): number {
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError("Result exceeds the safe integer range");
  }
  return Number(n);
}
