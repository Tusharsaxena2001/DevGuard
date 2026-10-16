import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProject, enroll, issueToken, login, seedUsers, sha, startApp, type EnrolledDevice, type SeededUsers } from "./auth-harness.js";
import { createTestPrisma, resetData } from "./support.js";

const prisma = createTestPrisma();
let app: NestExpressApplication;
let users: SeededUsers;
let admin: string;
let alice: EnrolledDevice;
let bob: EnrolledDevice;
let projectId: string;
let otherProjectId: string;

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetData(prisma);
  users = await seedUsers(prisma);
  admin = await login(app, users.admin.email);
  alice = await enroll(app, await issueToken(app, admin, users.alice.id), "alice-laptop");
  bob = await enroll(app, await issueToken(app, admin, users.bob.id), "bob-laptop");
  projectId = await createProject(app, admin, "payments");
  otherProjectId = await createProject(app, admin, "website");
  await request(http()).put(`/v1/projects/${projectId}/members`).set("Cookie", admin).send({ userIds: [users.alice.id] });
  await request(http()).put(`/v1/projects/${otherProjectId}/members`).set("Cookie", admin).send({ userIds: [users.bob.id] });
});

const http = (): ReturnType<NestExpressApplication["getHttpServer"]> => app.getHttpServer();

const event = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  idempotencyKey: randomUUID(),
  correlationId: randomUUID(),
  occurredAt: "2026-06-01T12:00:00.000Z",
  projectId,
  destination: { host: "github.com", repoPath: "personal/fork" },
  operation: "push",
  refs: ["refs/heads/main"],
  outcome: "blocked",
  ruleIds: ["destination_not_approved"],
  findings: [],
  mode: "enforce",
  wouldBlock: true,
  policyVersion: 1,
  agentVersion: "0.1.0",
  ...over,
});
const post = (device: EnrolledDevice | undefined, events: unknown[]) => {
  const req = request(http()).post("/v1/agent/events");
  if (device) req.set("Authorization", device.bearer);
  return req.send({ events });
};

describe("POST /v1/agent/events", () => {
  it("stores events with the device and owner taken from the credential", async () => {
    const e = event({ findings: [{ ruleId: "github_token", kind: "secret", path: "src/config.ts", line: 12, commit: sha("c") }] });
    const res = await post(alice, [e]);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([{ idempotencyKey: e["idempotencyKey"], status: "accepted" }]);
    const row = await prisma.securityEvent.findFirstOrThrow();
    expect(row).toMatchObject({ deviceId: alice.deviceId, userId: users.alice.id, projectId, destHost: "github.com", destRepo: "personal/fork", outcome: "blocked", mode: "enforce", wouldBlock: true, policyVersion: 1, agentVersion: "0.1.0" });
    expect(row.findings).toEqual([{ ruleId: "github_token", kind: "secret", path: "src/config.ts", line: 12, commit: sha("c") }]);
  });

  it("ignores any identity claimed in the body: unknown fields are rejected", async () => {
    for (const extra of [{ deviceId: bob.deviceId }, { userId: users.bob.id }, { device: { id: bob.deviceId } }]) {
      expect((await post(alice, [event(extra)])).status).toBe(400);
    }
    expect(await prisma.securityEvent.count()).toBe(0);
  });

  it("rejects content-like fields with 400 and stores nothing (no file contents, diffs or secret values)", async () => {
    const synthetic = ["gh", "p_", "Q".repeat(36)].join("");
    const bad = [
      event({ content: synthetic }),
      event({ diff: `+${synthetic}` }),
      event({ findings: [{ ruleId: "github_token", kind: "secret", path: "a.ts", match: synthetic }] }),
      event({ findings: [{ ruleId: "github_token", kind: "secret", path: "a.ts", text: synthetic }] }),
    ];
    for (const e of bad) {
      const res = await post(alice, [e]);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(synthetic);
    }
    expect(await prisma.securityEvent.count()).toBe(0);
  });

  it("one malformed event rejects the whole batch", async () => {
    const good = event();
    expect((await post(alice, [good, event({ outcome: "exploded" })])).status).toBe(400);
    expect(await prisma.securityEvent.count()).toBe(0);
  });

  it("treats a repeated idempotency key as a no-op, within a batch and across calls", async () => {
    const e = event();
    const first = await post(alice, [e, e]);
    expect(first.body.results.map((r: { status: string }) => r.status)).toEqual(["accepted", "duplicate"]);
    const second = await post(alice, [e]);
    expect(second.body.results[0].status).toBe("duplicate");
    expect(await prisma.securityEvent.count()).toBe(1);
  });

  it("keeps idempotency keys per device: another device may reuse a key", async () => {
    const e = event({ projectId: null });
    await post(alice, [e]);
    expect((await post(bob, [e])).body.results[0].status).toBe("accepted");
    expect(await prisma.securityEvent.count()).toBe(2);
  });

  it("rejects an event for a project the owner is not assigned to, without storing it, and still stores the rest", async () => {
    const foreign = event({ projectId: otherProjectId });
    const mine = event();
    const res = await post(alice, [foreign, mine]);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { idempotencyKey: foreign["idempotencyKey"], status: "rejected" },
      { idempotencyKey: mine["idempotencyKey"], status: "accepted" },
    ]);
    expect(await prisma.securityEvent.count({ where: { projectId: otherProjectId } })).toBe(0);
    expect(await prisma.securityEvent.count()).toBe(1);
  });

  it("rejects an event whose ids are not UUIDs as a final answer instead of failing the whole batch", async () => {
    const bad = event({ projectId: "proj-1" });
    const badException = event({ exceptionId: "not-a-uuid" });
    const good = event();
    const res = await post(alice, [bad, badException, good]);
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(["rejected", "rejected", "accepted"]);
    expect(await prisma.securityEvent.count()).toBe(1);
  });

  it("accepts events without a project, destination or mode (unprotected or unparsable cases)", async () => {
    const res = await post(alice, [event({ projectId: null, destination: null, mode: null, policyVersion: null, outcome: "error", ruleIds: ["internal_error"] })]);
    expect(res.body.results[0].status).toBe("accepted");
    expect(await prisma.securityEvent.findFirstOrThrow()).toMatchObject({ projectId: null, destHost: null, destRepo: null, mode: null });
  });

  it("requires a device credential: anonymous, wrong secret, revoked device and dashboard session are all 401", async () => {
    expect((await post(undefined, [event()])).status).toBe(401);
    const wrong = await request(http()).post("/v1/agent/events").set("Authorization", `Bearer ${alice.deviceId}.dgs_wrong`).send({ events: [event()] });
    expect(wrong.status).toBe(401);
    expect((await request(http()).post("/v1/agent/events").set("Cookie", admin).send({ events: [event()] })).status).toBe(401);
    await request(http()).post(`/v1/devices/${alice.deviceId}/revoke`).set("Cookie", admin);
    const revoked = await post(alice, [event()]);
    expect(revoked.status).toBe(401);
    expect(revoked.body.code).toBe("device_revoked");
    expect(await prisma.securityEvent.count()).toBe(0);
  });

  it.each([[[]], [[...Array(101)].map(() => ({}))]])("rejects an empty or oversized batch (%#) with 400", async (events) => {
    expect((await post(alice, events)).status).toBe(400);
  });

  it("accepts a large batch (100 events with 50 findings each, about 0.6 MB)", async () => {
    const findings = Array.from({ length: 50 }, (_, i) => ({ ruleId: "github_token", kind: "secret", path: `src/generated/file-${i}.ts`, line: i + 1, commit: sha("d") }));
    const events = Array.from({ length: 100 }, () => event({ findings }));
    const res = await post(alice, events);
    expect(res.status).toBe(200);
    expect(await prisma.securityEvent.count()).toBe(100);
  });

  it("answers an oversized body with a clean 413 and stores nothing", async () => {
    const huge = Array.from({ length: 100 }, () => event({ findings: Array.from({ length: 500 }, (_, i) => ({ ruleId: "github_token", kind: "secret", path: `src/generated/a-long-directory-name/file-${i}.ts`, line: i + 1, commit: sha("d") })) }));
    const res = await post(alice, huge);
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("validation_failed");
    expect(await prisma.securityEvent.count()).toBe(0);
  });
});

describe("GET /v1/events", () => {
  async function seedEvents(): Promise<void> {
    await post(alice, [
      event({ occurredAt: "2026-06-01T10:00:00.000Z", outcome: "allowed", ruleIds: [], wouldBlock: false, destination: { host: "github.com", repoPath: "acme/portal" }, correlationId: "corr-alice-1" }),
      event({ occurredAt: "2026-06-01T11:00:00.000Z", correlationId: "corr-alice-2", findings: [{ ruleId: "github_token", kind: "secret", path: "a.ts" }], ruleIds: ["secret_detected"] }),
    ]);
    await post(bob, [event({ projectId: otherProjectId, occurredAt: "2026-06-01T12:00:00.000Z", correlationId: "corr-bob-1" })]);
  }
  const list = (cookie: string, query = "") => request(http()).get(`/v1/events${query}`).set("Cookie", cookie);

  it("shows admins every event, newest first, with names and a total", async () => {
    await seedEvents();
    const res = await list(admin);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, page: 1, pageSize: 50 });
    expect(res.body.items.map((e: { correlationId: string }) => e.correlationId)).toEqual(["corr-bob-1", "corr-alice-2", "corr-alice-1"]);
    expect(res.body.items[0]).toMatchObject({ deviceName: "bob-laptop", userName: "bob", projectName: "website", destination: { host: "github.com", repoPath: "personal/fork" } });
  });

  it("shows an employee only their own events, whatever they ask for", async () => {
    await seedEvents();
    const aliceCookie = await login(app, users.alice.email);
    const own = await list(aliceCookie);
    expect(own.body.total).toBe(2);
    expect(own.body.items.every((e: { userId: string }) => e.userId === users.alice.id)).toBe(true);
    const asBob = await list(aliceCookie, `?userId=${users.bob.id}`);
    expect(asBob.body.total).toBe(0);
    const byProject = await list(aliceCookie, `?projectId=${otherProjectId}`);
    expect(byProject.body.total).toBe(0);
  });

  it.each([
    ["outcome", "?outcome=allowed", 1],
    ["rule id", "?ruleId=secret_detected", 1],
    ["project", "", 3],
    ["correlation id", "?correlationId=corr-alice-2", 1],
    ["destination host and repo", "?destHost=github.com&destRepo=acme/portal", 1],
    ["date range", "?from=2026-06-01T10:30:00.000Z&to=2026-06-01T11:30:00.000Z", 1],
  ])("filters by %s", async (_name, query, count) => {
    await seedEvents();
    expect((await list(admin, query)).body.total).toBe(count);
  });

  it("filters by project, device and user", async () => {
    await seedEvents();
    expect((await list(admin, `?projectId=${otherProjectId}`)).body.total).toBe(1);
    expect((await list(admin, `?deviceId=${alice.deviceId}`)).body.total).toBe(2);
    expect((await list(admin, `?userId=${users.bob.id}`)).body.total).toBe(1);
  });

  it("paginates", async () => {
    await seedEvents();
    const page1 = await list(admin, "?pageSize=2&page=1");
    const page2 = await list(admin, "?pageSize=2&page=2");
    expect(page1.body.items).toHaveLength(2);
    expect(page2.body.items).toHaveLength(1);
    expect(page1.body.total).toBe(3);
    const ids = [...page1.body.items, ...page2.body.items].map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("refuses very deep pages", async () => {
    expect((await list(admin, "?page=500&pageSize=200")).status).toBe(400);
    expect((await list(admin, "?page=100&pageSize=200")).status).toBe(200);
  });

  it.each([["?pageSize=1000"], ["?page=0"], ["?outcome=nope"], ["?projectId=not-a-uuid"], ["?unknown=1"], ["?from=yesterday"]])("rejects the bad query %s with 400", async (query) => {
    expect((await list(admin, query)).status).toBe(400);
  });

  it("requires a session: anonymous and device credentials are 401", async () => {
    expect((await request(http()).get("/v1/events")).status).toBe(401);
    expect((await request(http()).get("/v1/events").set("Authorization", alice.bearer)).status).toBe(401);
  });
});

describe("GET /v1/events/:id", () => {
  it("returns one event to an admin or its owner, and 404 to anyone else", async () => {
    await post(alice, [event({ correlationId: "corr-alice-1" })]);
    const id = (await prisma.securityEvent.findFirstOrThrow()).id;
    expect((await request(http()).get(`/v1/events/${id}`).set("Cookie", admin)).body.correlationId).toBe("corr-alice-1");
    const aliceCookie = await login(app, users.alice.email);
    const bobCookie = await login(app, users.bob.email);
    expect((await request(http()).get(`/v1/events/${id}`).set("Cookie", aliceCookie)).status).toBe(200);
    expect((await request(http()).get(`/v1/events/${id}`).set("Cookie", bobCookie)).status).toBe(404);
    expect((await request(http()).get("/v1/events/00000000-0000-4000-8000-000000000000").set("Cookie", admin)).status).toBe(404);
    expect((await request(http()).get("/v1/events/nope").set("Cookie", admin)).status).toBe(400);
  });

  it("exposes no content fields: only rule, kind, path, line and commit per finding", async () => {
    await post(alice, [event({ findings: [{ ruleId: "github_token", kind: "secret", path: "src/a.ts", line: 3, commit: sha("e") }] })]);
    const id = (await prisma.securityEvent.findFirstOrThrow()).id;
    const body = (await request(http()).get(`/v1/events/${id}`).set("Cookie", admin)).body;
    expect(body.findings).toEqual([{ ruleId: "github_token", kind: "secret", path: "src/a.ts", line: 3, commit: sha("e") }]);
    expect(JSON.stringify(body)).not.toMatch(/idempotency|secretHash|password/i);
  });
});
