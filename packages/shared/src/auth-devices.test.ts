import { describe, expect, it } from "vitest";
import {
  CreateUserRequestSchema,
  DeviceSummarySchema,
  EnrollRequestSchema,
  LoginRequestSchema,
  EnrollResponseSchema,
  formatDeviceCredential,
  parseDeviceCredential,
} from "./index.js";

describe("LoginRequest", () => {
  it("accepts email + password and rejects unknown keys", () => {
    expect(LoginRequestSchema.safeParse({ email: "a@example.test", password: "x" }).success).toBe(true);
    expect(LoginRequestSchema.safeParse({ email: "a@example.test", password: "x", role: "admin" }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });
});

describe("CreateUserRequest", () => {
  const base = { email: "a@example.test", name: "A", password: "p".repeat(12) };
  it("requires a long enough password and defaults isAdmin to false", () => {
    const ok = CreateUserRequestSchema.parse(base);
    expect(ok.isAdmin).toBe(false);
    expect(CreateUserRequestSchema.safeParse({ ...base, password: "short" }).success).toBe(false);
  });
});

describe("EnrollRequest", () => {
  it("is strict", () => {
    const ok = { token: "t", deviceName: "laptop", os: "linux", agentVersion: "0.1.0" };
    expect(EnrollRequestSchema.safeParse(ok).success).toBe(true);
    expect(EnrollRequestSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(EnrollRequestSchema.safeParse({ ...ok, token: "" }).success).toBe(false);
  });
});

describe("DeviceSummary", () => {
  it("has no secret or hash fields", () => {
    const base = {
      id: "d1",
      userId: "u1",
      name: "n",
      os: "linux",
      agentVersion: "0.1.0",
      status: "active",
      enrolledAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: null,
      revokedAt: null,
    };
    expect(DeviceSummarySchema.safeParse(base).success).toBe(true);
    expect(DeviceSummarySchema.safeParse({ ...base, secretHash: "x" }).success).toBe(false);
  });
});

describe("device credential", () => {
  it("round-trips and splits at the first separator only", () => {
    const value = formatDeviceCredential("dev-1", "se.cret");
    expect(parseDeviceCredential(value)).toEqual({ ok: true, deviceId: "dev-1", deviceSecret: "se.cret" });
  });
  it.each(["", "nodot", ".secret", "id."])("rejects malformed value %j", (value) => {
    expect(parseDeviceCredential(value)).toEqual({ ok: false });
  });
});

describe("EnrollResponse", () => {
  it("bounds the secret so it always fits the agent's credential file", () => {
    expect(EnrollResponseSchema.safeParse({ deviceId: "d", deviceSecret: "s".repeat(512) }).success).toBe(true);
    expect(EnrollResponseSchema.safeParse({ deviceId: "d", deviceSecret: "s".repeat(513) }).success).toBe(false);
  });
});
