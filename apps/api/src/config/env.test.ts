import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const valid = {
  DATABASE_URL: "postgresql://u:p@localhost:5433/db",
  JWT_SECRET: "x".repeat(32),
  DASHBOARD_BASE_URL: "http://localhost:5173",
};

describe("parseEnv", () => {
  it("accepts a minimal valid environment and applies defaults", () => {
    const result = parseEnv(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.API_PORT).toBe(3000);
      expect(result.env.NODE_ENV).toBe("development");
      expect(result.env.EXCEPTION_MAX_TTL_HOURS).toBe(72);
    }
  });

  it("coerces numeric strings", () => {
    const result = parseEnv({ ...valid, API_PORT: "4010", SESSION_TTL_MINUTES: "15" });
    expect(result.ok && result.env.API_PORT).toBe(4010);
    expect(result.ok && result.env.SESSION_TTL_MINUTES).toBe(15);
  });

  it.each([
    ["missing DATABASE_URL", { ...valid, DATABASE_URL: undefined }, "DATABASE_URL"],
    ["non-postgres DATABASE_URL", { ...valid, DATABASE_URL: "mysql://localhost/db" }, "DATABASE_URL"],
    ["short JWT_SECRET", { ...valid, JWT_SECRET: "short" }, "JWT_SECRET"],
    ["missing JWT_SECRET", { ...valid, JWT_SECRET: undefined }, "JWT_SECRET"],
    ["bad dashboard URL", { ...valid, DASHBOARD_BASE_URL: "not a url" }, "DASHBOARD_BASE_URL"],
    ["port out of range", { ...valid, API_PORT: "70000" }, "API_PORT"],
    ["zero TTL", { ...valid, SESSION_TTL_MINUTES: "0" }, "SESSION_TTL_MINUTES"],
    ["unknown NODE_ENV", { ...valid, NODE_ENV: "staging" }, "NODE_ENV"],
  ])("rejects %s and names the variable", (_name, raw, variable) => {
    const result = parseEnv(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.some((p) => p.startsWith(`${variable}:`))).toBe(true);
  });

  it("never echoes a rejected secret value in its problems", () => {
    const secret = "short-secret-value-123";
    const url = "mysql://user:hunter2-password@host/db";
    const result = parseEnv({ ...valid, JWT_SECRET: secret, DATABASE_URL: url });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const text = result.problems.join("\n");
      expect(text).not.toContain(secret);
      expect(text).not.toContain("hunter2");
    }
  });
});
