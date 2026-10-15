import { describe, expect, it } from "vitest";
import type { ValidException } from "@devguard/shared";
import { validateException, type ExceptionScope } from "./exception.js";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const dest = { host: "github.com", repoPath: "acme/portal" };

const exception = (over: Partial<ValidException> = {}): ValidException => ({
  id: "ex1",
  projectId: "p1",
  destination: dest,
  status: "approved",
  expiresAt: "2026-06-02T12:00:00.000Z",
  approverId: "lead",
  requesterId: "dev",
  waivedRuleIds: [],
  ...over,
});
const scope = (over: Partial<ExceptionScope> = {}): ExceptionScope => ({ projectId: "p1", destination: dest, now: NOW, ...over });

describe("validateException", () => {
  it("accepts an approved, in-scope, unexpired exception", () => {
    const e = exception();
    expect(validateException(e, scope())).toEqual({ ok: true, value: e });
  });

  it.each([
    ["pending", "pending"],
    ["rejected", "rejected"],
    ["expired", "expired"],
    ["revoked", "revoked"],
  ] as const)("rejects status %s", (_n, status) => {
    expect(validateException(exception({ status }), scope())).toEqual({ ok: false, reason: "not_approved" });
  });

  it("rejects another project", () => {
    expect(validateException(exception({ projectId: "p2" }), scope())).toEqual({ ok: false, reason: "wrong_project" });
  });

  it.each([
    ["other host", { host: "gitlab.com", repoPath: "acme/portal" }],
    ["other repo", { host: "github.com", repoPath: "acme/other" }],
    ["lookalike host", { host: "github.com.evil.io", repoPath: "acme/portal" }],
    ["repo prefix", { host: "github.com", repoPath: "acme/portal-fork" }],
    ["owner only", { host: "github.com", repoPath: "acme" }],
    ["port variant", { host: "github.com:8443", repoPath: "acme/portal" }],
  ])("rejects a destination mismatch: %s", (_n, destination) => {
    expect(validateException(exception({ destination }), scope())).toEqual({ ok: false, reason: "wrong_destination" });
  });

  it("rejects an exception approved by its own requester", () => {
    expect(validateException(exception({ approverId: "dev", requesterId: "dev" }), scope())).toEqual({
      ok: false,
      reason: "self_approved",
    });
  });

  describe("expiry boundary", () => {
    it("is valid one millisecond before expiresAt", () => {
      expect(validateException(exception({ expiresAt: "2026-06-01T12:00:00.001Z" }), scope()).ok).toBe(true);
    });
    it("is expired exactly at expiresAt", () => {
      expect(validateException(exception({ expiresAt: NOW.toISOString() }), scope())).toEqual({ ok: false, reason: "expired" });
    });
    it("is expired after expiresAt", () => {
      expect(validateException(exception({ expiresAt: "2026-06-01T11:59:59.999Z" }), scope())).toEqual({
        ok: false,
        reason: "expired",
      });
    });
  });

  it.each(["", "not a date", "2026-13-45T00:00:00Z", "2026-06-02T12:00:00", "June 2 2999", "2026-06-02"])("rejects an unparsable expiry %j", (expiresAt) => {
    expect(validateException(exception({ expiresAt }), scope())).toEqual({ ok: false, reason: "invalid_time" });
  });

  it.each([
    ["offset form", "2999-01-01T00:00:00+01:00"],
    ["Infinity", "Infinity"],
  ])("rejects non-strict expiry (%s) as invalid_time rather than guessing a timezone", (_n, expiresAt) => {
    expect(validateException(exception({ expiresAt }), scope())).toEqual({ ok: false, reason: "invalid_time" });
  });

  it("accepts a far-future strict expiry", () => {
    expect(validateException(exception({ expiresAt: "9999-12-31T23:59:59.000Z" }), scope()).ok).toBe(true);
  });

  it.each([
    ["GitHub.com", { host: "GitHub.com", repoPath: "acme/portal" }],
    [".git suffix", { host: "github.com", repoPath: "acme/portal.git" }],
    ["trailing slash", { host: "github.com", repoPath: "acme/portal/" }],
    ["case variant path", { host: "github.com", repoPath: "Acme/Portal" }],
  ])("requires normalized stored destinations: %s does not match", (_n, destination) => {
    expect(validateException(exception({ destination }), scope())).toEqual({ ok: false, reason: "wrong_destination" });
  });

  it("reports the first failing condition (precedence is a contract)", () => {
    const expired = "2020-01-01T00:00:00.000Z";
    const all = { status: "pending" as const, projectId: "p2", destination: { host: "x.io", repoPath: "a/b" }, approverId: "dev", expiresAt: expired };
    expect(validateException(exception(all), scope())).toMatchObject({ reason: "not_approved" });
    expect(validateException(exception({ ...all, status: "approved" }), scope())).toMatchObject({ reason: "wrong_project" });
    expect(validateException(exception({ ...all, status: "approved", projectId: "p1" }), scope())).toMatchObject({ reason: "wrong_destination" });
    expect(validateException(exception({ ...all, status: "approved", projectId: "p1", destination: dest }), scope())).toMatchObject({ reason: "self_approved" });
    expect(validateException(exception({ ...all, status: "approved", projectId: "p1", destination: dest, approverId: "lead" }), scope())).toMatchObject({ reason: "expired" });
  });

  it("treats identical empty approver and requester ids as self-approved (fail closed)", () => {
    expect(validateException(exception({ approverId: "", requesterId: "" }), scope())).toMatchObject({ reason: "self_approved" });
  });

  it("rejects an invalid `now` instead of validating by accident", () => {
    expect(validateException(exception(), scope({ now: new Date("nope") }))).toEqual({ ok: false, reason: "invalid_time" });
  });

  it("does not mutate its input", () => {
    const e = exception({ waivedRuleIds: ["secret_detected"] });
    const s = scope();
    const before = JSON.stringify({ e, s, now: s.now.getTime() });
    Object.freeze(e.waivedRuleIds);
    Object.freeze(e);
    Object.freeze(s.destination);
    Object.freeze(s);
    expect(validateException(e, s).ok).toBe(true);
    expect(JSON.stringify({ e, s, now: s.now.getTime() })).toBe(before);
  });
});
