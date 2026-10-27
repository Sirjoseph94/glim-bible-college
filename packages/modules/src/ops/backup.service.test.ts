import { describe, expect, it } from "vitest";
import { pgDumpEnv } from "./backup.service";

describe("pgDumpEnv", () => {
  it("passes the connection in the environment, decoding the user and password", () => {
    expect(pgDumpEnv("postgres://glim%40app:p%40ss@db.example:6543/glim")).toEqual({
      PATH: "/usr/local/bin:/usr/bin:/bin",
      PGHOST: "db.example",
      PGPORT: "6543",
      PGUSER: "glim@app",
      PGPASSWORD: "p@ss",
      PGDATABASE: "glim",
      PGSSLMODE: "prefer",
    });
  });

  it("verifies the server against the system CA store when sslmode verifies and no CA is given", () => {
    const env = pgDumpEnv(
      "postgres://u:p@ep-x.eu-central-1.aws.neon.tech/glim?sslmode=verify-full",
    );
    expect(env.PGSSLMODE).toBe("verify-full");
    expect(env.PGSSLROOTCERT).toBe("system");
  });

  it("uses the URL's own sslrootcert when it has one", () => {
    const env = pgDumpEnv("postgres://u:p@h/glim?sslmode=verify-ca&sslrootcert=/run/ca.crt");
    expect(env.PGSSLROOTCERT).toBe("/run/ca.crt");
  });

  it("sets no root certificate when sslmode doesn't verify", () => {
    expect(pgDumpEnv("postgres://u:p@h/glim?sslmode=require")).not.toHaveProperty("PGSSLROOTCERT");
  });
});
