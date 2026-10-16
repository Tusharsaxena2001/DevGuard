import { describe, expect, it } from "vitest";
import type { ExceptionEntry } from "@devguard/shared";
import { fail, ok } from "../result.js";
import { cachedPolicy, fakeApi, fakeGit, fakeStore, syntheticSecret } from "../../test/support/fakes.js";
import type { ConfigStore } from "../ports/config-store.js";
import { exceptionStatus, requestException } from "./request-exception.js";

const REASON = "Customer asked for a copy in their own repository";
const enrolled = { config: ok({ serverUrl: "https://devguard.example.test", deviceId: "dev-1" }), credentials: ok({ deviceId: "dev-1", deviceSecret: syntheticSecret() }) };
const entry = (over: Partial<ExceptionEntry> = {}): ExceptionEntry => ({
  id: "11111111-1111-4111-8111-111111111111",
  projectId: "proj-1",
  projectName: "Portal",
  requesterId: "user-1",
  requesterName: "alice",
  deviceId: null,
  destination: { host: "github.com", repoPath: "customer/portal-copy" },
  reason: REASON,
  status: "pending",
  eventId: null,
  createdAt: "2026-06-01T12:00:00.000Z",
  expiresAt: null,
  decisions: [],
  ...over,
});
/** A repo registered to proj-1 (manual match), with its policy cached. */
const protectedRepo = (): ConfigStore => fakeStore({ ...enrolled, repos: ok({ repos: [{ repoPath: "/repo", projectId: "proj-1", registeredAt: "2026-06-01T12:00:00.000Z" }] }) }, { "proj-1": ok(cachedPolicy("proj-1")) });

describe("requestException", () => {
  it("sends the explicit project, the canonical https destination and the trimmed reason", async () => {
    const api = fakeApi({ requestException: ok(entry()) });
    const outcome = await requestException({ store: fakeStore(enrolled), git: fakeGit(), api }, { destination: "git@GitHub.com:Customer/Portal-Copy.git", reason: `  ${REASON}  `, projectId: "proj-1", cwd: "/repo" });
    expect(outcome).toMatchObject({ state: "requested" });
    expect(api.calls[0]?.args[1]).toEqual({ projectId: "proj-1", destination: "https://github.com/customer/portal-copy", reason: REASON });
  });

  it("never sends credentials that sit in the destination URL", async () => {
    const token = ["gh", "p_", "Z".repeat(36)].join("");
    const api = fakeApi({ requestException: ok(entry()) });
    await requestException({ store: fakeStore(enrolled), git: fakeGit(), api }, { destination: `https://${token}@github.com/customer/portal-copy.git`, reason: REASON, projectId: "proj-1", cwd: "/repo" });
    expect(JSON.stringify(api.calls)).not.toContain(token);
  });

  it("takes the project from the current repository when it belongs to exactly one", async () => {
    const api = fakeApi({ requestException: ok(entry()) });
    await requestException({ store: protectedRepo(), git: fakeGit(), api }, { destination: "https://github.com/customer/portal-copy", reason: REASON, cwd: "/repo" });
    expect((api.calls[0]?.args[1] as { projectId: string }).projectId).toBe("proj-1");
  });

  it("asks for --project when the repository matches none or several projects, and sends nothing", async () => {
    const api = fakeApi({ requestException: ok(entry()) });
    const none = await requestException({ store: fakeStore(enrolled), git: fakeGit(), api }, { destination: "https://github.com/a/b", reason: REASON, cwd: "/repo" });
    expect(none).toEqual({ state: "needs_project", candidates: [] });
    const notARepo = await requestException({ store: protectedRepo(), git: fakeGit({ repoRoot: undefined }), api }, { destination: "https://github.com/a/b", reason: REASON, cwd: "/tmp" });
    expect(notARepo).toEqual({ state: "needs_project", candidates: [] });
    const two = fakeStore({ ...enrolled, repos: ok({ repos: [{ repoPath: "/repo", projectId: "proj-1", registeredAt: "x" }, { repoPath: "/repo", projectId: "proj-2", registeredAt: "x" }] }) }, { "proj-1": ok(cachedPolicy("proj-1")), "proj-2": ok(cachedPolicy("proj-2")) });
    const several = await requestException({ store: two, git: fakeGit(), api }, { destination: "https://github.com/a/b", reason: REASON, cwd: "/repo" });
    expect(several).toMatchObject({ state: "needs_project", candidates: [{ projectId: expect.any(String) }, { projectId: expect.any(String) }] });
    expect(api.calls).toEqual([]);
  });

  it.each([
    ["a destination that does not parse", { destination: "not a url", reason: REASON }],
    ["a reason that is too short", { destination: "https://github.com/a/b", reason: "because" }],
    ["a blank reason", { destination: "https://github.com/a/b", reason: "         " }],
  ])("refuses %s before contacting the server", async (_name, over) => {
    const api = fakeApi({ requestException: ok(entry()) });
    await expect(requestException({ store: fakeStore(enrolled), git: fakeGit(), api }, { ...over, projectId: "proj-1", cwd: "/repo" })).rejects.toMatchObject({ code: "usage_error" });
    expect(api.calls).toEqual([]);
  });

  it("does nothing when the device is not enrolled", async () => {
    const api = fakeApi({ requestException: ok(entry()) });
    expect(await requestException({ store: fakeStore(), git: fakeGit(), api }, { destination: "https://github.com/a/b", reason: REASON, projectId: "p", cwd: "/repo" })).toEqual({ state: "not_enrolled" });
    expect(api.calls).toEqual([]);
  });

  it.each(["unreachable", "rejected", "unauthorized", "revoked", "rate_limited"] as const)("reports a %s failure without inventing a request", async (reason) => {
    const outcome = await requestException({ store: fakeStore(enrolled), git: fakeGit(), api: fakeApi({ requestException: fail(reason) }) }, { destination: "https://github.com/a/b", reason: REASON, projectId: "proj-1", cwd: "/repo" });
    expect(outcome).toEqual({ state: "failed", reason });
  });
});

describe("exceptionStatus", () => {
  it("lists the owner's requests, or one by id", async () => {
    const api = fakeApi({ listExceptions: ok({ items: [entry()], total: 1, page: 1, pageSize: 50 }), getException: ok(entry({ status: "approved" })) });
    expect(await exceptionStatus({ store: fakeStore(enrolled), api }, undefined)).toMatchObject({ state: "list" });
    expect(await exceptionStatus({ store: fakeStore(enrolled), api }, "abc")).toMatchObject({ state: "one", entry: { status: "approved" } });
    expect(api.calls.map((c) => c.method)).toEqual(["listExceptions", "getException"]);
  });

  it("reports failures and an unenrolled device without calling the server", async () => {
    const api = fakeApi({ listExceptions: fail("unreachable") });
    expect(await exceptionStatus({ store: fakeStore(enrolled), api }, undefined)).toEqual({ state: "failed", reason: "unreachable" });
    const none = fakeApi();
    expect(await exceptionStatus({ store: fakeStore(), api: none }, undefined)).toEqual({ state: "not_enrolled" });
    expect(none.calls).toEqual([]);
  });
});
