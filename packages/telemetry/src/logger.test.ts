import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  return { lines, stream };
}

describe("createLogger", () => {
  it("writes JSON lines with the service name", () => {
    const { lines, stream } = capture();
    createLogger({ service: "api", level: "info" }, stream).info({ jobId: "j1" }, "job done");
    expect(lines[0]).toMatchObject({ service: "api", jobId: "j1", msg: "job done", level: "info" });
  });

  it("never writes credentials, tokens or spiritual-background answers (INV-12, INV-15)", () => {
    const { lines, stream } = capture();
    createLogger({ service: "api", level: "info" }, stream).info(
      {
        req: { headers: { authorization: "Bearer abc", cookie: "sid=xyz", "x-csrf-token": "t" } },
        body: { password: "hunter2", email: "a@b.c" },
        user: { accessToken: "ya29.secret", refreshToken: "1//secret", idToken: "eyJ" },
        application: {
          spiritualBackground: { bornAgainWhen: "testimony", waterBaptism: "baptism" },
        },
        secret: "s",
      },
      "request",
    );
    const text = JSON.stringify(lines[0]);
    for (const value of [
      "Bearer abc",
      "sid=xyz",
      "hunter2",
      "ya29.secret",
      "1//secret",
      "eyJ",
      "testimony",
      "baptism",
      '"s"',
      '"t"',
    ]) {
      expect(text, value).not.toContain(value);
    }
    expect(text).toContain("a@b.c");
  });
});
