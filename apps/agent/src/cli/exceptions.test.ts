import { describe, expect, it } from "vitest";
import type { ExceptionEntry } from "@devguard/shared";
import { fail, ok } from "../result.js";
import { cliDeps, fakeApi, fakeStore, recordingLogger, syntheticSecret } from "../../test/support/fakes.js";
import { runCli } from "./run.js";

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
const out = (l: ReturnType<typeof recordingLogger>): string => [...l.out, ...l.err].join("\n");

describe("devguard request-exception", () => {
  const run = (api: ReturnType<typeof fakeApi>, argv: string[]) => {
    const logger = recordingLogger();
    return runCli(argv, cliDeps({ logger, api, store: fakeStore(enrolled) })).then((code) => ({ code, logger }));
  };
  const base = ["request-exception", "--project", "proj-1", "--destination", "https://github.com/customer/portal-copy", "--reason", REASON];

  it("prints the request id and what happens next, exit 0", async () => {
    const { code, logger } = await run(fakeApi({ requestException: ok(entry()) }), base);
    expect(code).toBe(0);
    expect(out(logger)).toContain("11111111-1111-4111-8111-111111111111");
    expect(out(logger)).toContain("An administrator has to approve it");
    expect(out(logger)).toContain("devguard exception status");
  });

  it("--json prints the id and status only", async () => {
    const { logger } = await run(fakeApi({ requestException: ok(entry()) }), ["--json", ...base]);
    expect(JSON.parse(logger.out.join(""))).toEqual({ requested: true, id: "11111111-1111-4111-8111-111111111111", status: "pending" });
  });

  it("asks for --project when the repository does not identify one (exit 2)", async () => {
    const { code, logger } = await run(fakeApi(), ["request-exception", "--destination", "https://github.com/a/b", "--reason", REASON]);
    expect(code).toBe(2);
    expect(out(logger)).toContain("--project");
  });

  it.each([
    ["rejected", "not assigned to that project"],
    ["unreachable", "Could not reach"],
    ["revoked", "has been revoked"],
  ] as const)("a %s failure exits 2 with an actionable message", async (reason, text) => {
    const { code, logger } = await run(fakeApi({ requestException: fail(reason) }), base);
    expect(code).toBe(2);
    expect(logger.err.join(" ")).toContain(text);
  });

  it("a destination that does not parse, or a short reason, exits 2 and sends nothing", async () => {
    const api = fakeApi({ requestException: ok(entry()) });
    expect((await run(api, ["request-exception", "--project", "p", "--destination", "nope", "--reason", REASON])).code).toBe(2);
    expect((await run(api, ["request-exception", "--project", "p", "--destination", "https://github.com/a/b", "--reason", "short"])).code).toBe(2);
    expect(api.calls).toEqual([]);
  });

  it("says so on an unenrolled device", async () => {
    const logger = recordingLogger();
    expect(await runCli(base, cliDeps({ logger }))).toBe(2);
    expect(out(logger)).toContain("not enrolled");
  });
});

describe("devguard exception status", () => {
  const run = (api: ReturnType<typeof fakeApi>, argv: string[]) => {
    const logger = recordingLogger();
    return runCli(argv, cliDeps({ logger, api, store: fakeStore(enrolled) })).then((code) => ({ code, logger }));
  };

  it("lists requests with their status and the approver's reason", async () => {
    const approved = entry({
      status: "approved",
      expiresAt: "2026-06-02T12:00:00.000Z",
      decisions: [{ decision: "approved", deciderId: "admin-1", deciderName: "Admin", reason: "Approved for the handover", expiresAt: "2026-06-02T12:00:00.000Z", decidedAt: "2026-06-01T13:00:00.000Z" }],
    });
    const { code, logger } = await run(fakeApi({ listExceptions: ok({ items: [approved, entry({ id: "22222222-2222-4222-8222-222222222222" })], total: 2, page: 1, pageSize: 50 }) }), ["exception", "status"]);
    expect(code).toBe(0);
    const text = out(logger);
    expect(text).toContain("approved until 2026-06-02T12:00:00.000Z");
    expect(text).toContain("Approved by Admin: Approved for the handover");
    expect(text).toContain("waiting for an administrator");
  });

  it("shows one request by id", async () => {
    const { code, logger } = await run(fakeApi({ getException: ok(entry({ status: "rejected", decisions: [{ decision: "rejected", deciderId: "a", deciderName: "Admin", reason: "Use the approved mirror", expiresAt: null, decidedAt: "2026-06-01T13:00:00.000Z" }] })) }), ["exception", "status", "11111111-1111-4111-8111-111111111111"]);
    expect(code).toBe(0);
    expect(out(logger)).toContain("Status: rejected");
    expect(out(logger)).toContain("Use the approved mirror");
  });

  it("an empty list says so, and failures exit 2", async () => {
    expect(out((await run(fakeApi({ listExceptions: ok({ items: [], total: 0, page: 1, pageSize: 50 }) }), ["exception", "status"])).logger)).toContain("no exception requests");
    const failed = await run(fakeApi({ listExceptions: fail("unreachable") }), ["exception", "status"]);
    expect(failed.code).toBe(2);
  });

  it("text from the server cannot smuggle terminal control characters", async () => {
    const hostile = entry({ decisions: [{ decision: "rejected", deciderId: "a", deciderName: "Adm\u001b[31min", reason: "bad‮evil\nsecond line", expiresAt: null, decidedAt: "2026-06-01T13:00:00.000Z" }], status: "rejected" });
    const { logger } = await run(fakeApi({ getException: ok(hostile) }), ["exception", "status", "x"]);
    expect(out(logger)).not.toMatch(/[\u001b‮]/);
  });
});
