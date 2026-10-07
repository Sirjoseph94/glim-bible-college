import { describe, expect, it } from "vitest";
import { AppError, domainError, err, isAppError, ok, unwrap, type Result } from "./result";

function parseLevel(n: number): Result<number, "LEVEL_OUT_OF_RANGE"> {
  return n === 1 || n === 2 ? ok(n) : err("LEVEL_OUT_OF_RANGE");
}

describe("Result", () => {
  it("carries a value on success and an error on failure", () => {
    const good = parseLevel(2);
    const bad = parseLevel(3);
    expect(good).toEqual({ ok: true, value: 2 });
    expect(bad).toEqual({ ok: false, error: "LEVEL_OUT_OF_RANGE" });
  });
});

describe("AppError", () => {
  it("carries an Appendix D code, its HTTP status and any field errors", () => {
    const e = new AppError("INTAKE_CLOSED", "The intake is closed.");
    expect(e.code).toBe("INTAKE_CLOSED");
    expect(e.status).toBe(422);
    expect(e.message).toBe("The intake is closed.");
    expect(isAppError(e)).toBe(true);
    expect(isAppError(new Error("x"))).toBe(false);

    const v = new AppError("VALIDATION_FAILED", "Invalid input.", {
      fieldErrors: [{ path: "email", code: "invalid_string", message: "Invalid email" }],
    });
    expect(v.status).toBe(400);
    expect(v.fieldErrors).toHaveLength(1);
  });
});

describe("domain errors", () => {
  it("unwrap returns the value of a success", () => {
    expect(unwrap(ok(42))).toBe(42);
  });

  it("unwrap turns an expected failure into an AppError for the API envelope", () => {
    const failure = err(
      domainError("VALIDATION_FAILED", "Use at least 12 characters.", {
        fieldErrors: [
          {
            path: "body.password",
            code: "password_too_short",
            message: "Use at least 12 characters.",
          },
        ],
      }),
    );
    expect(() => unwrap(failure)).toThrow(
      expect.objectContaining({
        code: "VALIDATION_FAILED",
        status: 400,
        fieldErrors: [expect.objectContaining({ path: "body.password" })],
      }),
    );
  });
});
