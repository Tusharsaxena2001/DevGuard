import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProject, enroll, issueToken, login, seedUsers, startApp, type EnrolledDevice, type SeededUsers } from "./auth-harness.js";
import { createTestPrisma, resetData } from "./support.js";

const prisma = createTestPrisma();
let app: NestExpressApplication;
let users: SeededUsers;
let admin: string;
let alice: EnrolledDevice;
let projectId: string;

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
  projectId = await createProject(app, admin, "payments");
  await request(http()).put(`/v1/projects/${projectId}/members`).set("Cookie", admin).send({ userIds: [users.alice.id] });
});

const http = (): ReturnType<NestExpressApplication["getHttpServer"]> => app.getHttpServer();

describe("every mutating admin operation writes an audit row", () => {
  it("covers users, devices, projects, assignments, destinations, canonical repos, fingerprints, policies and exceptions", async () => {
    const post = (path: string, body: object, cookie = admin) => request(http()).post(path).set("Cookie", cookie).send(body);
    await post("/v1/users", { email: "carol@example.test", name: "Carol", password: ["Carol", "Pass", "98765"].join("-") });
    const dest = await post(`/v1/projects/${projectId}/destinations`, { url: "https://github.com/acme/portal" });
    const canon = await post(`/v1/projects/${projectId}/canonical-repos`, { url: "https://github.com/acme/portal-mirror" });
    const fp = await post(`/v1/projects/${projectId}/fingerprints`, { fingerprint: "a".repeat(40) });
    await request(http()).put(`/v1/projects/${projectId}/policy`).set("Cookie", admin).send({ baseVersion: 1, mode: "audit_only", prohibitedGlobs: [".env"], secretRules: [] });
    await request(http()).patch(`/v1/projects/${projectId}`).set("Cookie", admin).send({ name: "payments-v2" });
    await request(http()).delete(`/v1/projects/${projectId}/destinations/${dest.body.id}`).set("Cookie", admin);
    await request(http()).delete(`/v1/projects/${projectId}/canonical-repos/${canon.body.id}`).set("Cookie", admin);
    await request(http()).delete(`/v1/projects/${projectId}/fingerprints/${fp.body.id}`).set("Cookie", admin);
    const ex = await request(http()).post("/v1/agent/exceptions").set("Authorization", alice.bearer).send({ projectId, destination: "https://github.com/customer/copy", reason: "Customer asked for a copy in their repo" });
    await post(`/v1/exceptions/${ex.body.id}/approve`, { reason: "Approved for the customer handover", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    await post(`/v1/exceptions/${ex.body.id}/revoke`, { reason: "No longer needed after handover" });
    await post(`/v1/devices/${alice.deviceId}/revoke`, {});

    const actions = new Set((await prisma.adminAuditEvent.findMany()).map((a) => a.action));
    for (const action of [
      "user.created",
      "device.enrollment_token_issued",
      "device.enrolled",
      "device.revoked",
      "project.created",
      "project.updated",
      "project.members_changed",
      "destination.added",
      "destination.removed",
      "canonical_repo.added",
      "canonical_repo.removed",
      "fingerprint.added",
      "fingerprint.removed",
      "policy.updated",
      "exception.requested",
      "exception.approved",
      "exception.revoked",
    ]) {
      expect(actions, action).toContain(action);
    }
  });

  it("no audit summary contains a credential, token, password or secret value", async () => {
    await request(http()).post("/v1/users").set("Cookie", admin).send({ email: "carol@example.test", name: "Carol", password: ["Carol", "Pass", "98765"].join("-") });
    const text = JSON.stringify(await prisma.adminAuditEvent.findMany());
    expect(text).not.toMatch(/Pass-98765|dgs_|dgt_|argon2|passwordHash|secretHash/);
  });
});

describe("GET /v1/audit", () => {
  it("lists history newest first with actor names, and is admin-only", async () => {
    const res = await request(http()).get("/v1/audit").set("Cookie", admin);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(3);
    const times = res.body.items.map((i: { occurredAt: string }) => i.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(res.body.items.find((i: { action: string }) => i.action === "project.created")).toMatchObject({ actorName: "admin", targetType: "project", targetId: projectId, summary: { name: "payments" } });
    const aliceSession = await login(app, users.alice.email);
    expect((await request(http()).get("/v1/audit").set("Cookie", aliceSession)).status).toBe(403);
    expect((await request(http()).get("/v1/audit")).status).toBe(401);
    expect((await request(http()).get("/v1/audit").set("Authorization", alice.bearer)).status).toBe(401);
  });

  it.each([
    ["action", "?action=project.created", (a: { action: string }) => a.action === "project.created"],
    ["action family", "?actionPrefix=device", (a: { action: string }) => a.action.startsWith("device.")],
    ["target type", "?targetType=user", (a: { targetType: string }) => a.targetType === "user"],
  ])("filters by %s", async (_name, query, check) => {
    const res = await request(http()).get(`/v1/audit${query}`).set("Cookie", admin);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every(check)).toBe(true);
  });

  it("filters by actor, target and date range, and pages", async () => {
    expect((await request(http()).get(`/v1/audit?actorId=${users.admin.id}`).set("Cookie", admin)).body.items.every((i: { actorId: string }) => i.actorId === users.admin.id)).toBe(true);
    expect((await request(http()).get(`/v1/audit?targetId=${projectId}`).set("Cookie", admin)).body.items.length).toBeGreaterThan(0);
    expect((await request(http()).get("/v1/audit?to=2020-01-01T00:00:00.000Z").set("Cookie", admin)).body.total).toBe(0);
    const total = (await request(http()).get("/v1/audit").set("Cookie", admin)).body.total;
    const page = await request(http()).get("/v1/audit?pageSize=2&page=2").set("Cookie", admin);
    expect(page.body).toMatchObject({ page: 2, pageSize: 2, total });
    expect(page.body.items).toHaveLength(Math.min(2, Math.max(0, total - 2)));
  });

  it.each([["?pageSize=1000"], ["?page=0"], ["?page=500&pageSize=200"], ["?actorId=nope"], ["?unknown=1"], ["?from=yesterday"]])("rejects the bad query %s with 400", async (query) => {
    expect((await request(http()).get(`/v1/audit${query}`).set("Cookie", admin)).status).toBe(400);
  });

  it("offers no way to create, edit or delete an entry", async () => {
    const id = (await prisma.adminAuditEvent.findFirstOrThrow()).id;
    for (const method of ["post", "put", "patch", "delete"] as const) {
      expect([404, 405], method).toContain((await request(http())[method](`/v1/audit/${id}`).set("Cookie", admin).send({})).status);
      expect([404, 405], method).toContain((await request(http())[method]("/v1/audit").set("Cookie", admin).send({})).status);
    }
    await expect(prisma.adminAuditEvent.updateMany({ data: { action: "tampered" } })).rejects.toThrow();
    await expect(prisma.adminAuditEvent.deleteMany({})).rejects.toThrow();
  });
});

describe("GET /v1/metrics/summary", () => {
  const now = Date.now();
  const ev = (over: Record<string, unknown>) => ({
    deviceId: alice.deviceId,
    userId: users.alice.id,
    projectId,
    destHost: "github.com",
    destRepo: "personal/fork",
    operation: "push" as const,
    ruleIds: [] as string[],
    mode: "enforce" as const,
    outcome: "allowed" as const,
    correlationId: randomUUID(),
    occurredAt: new Date(now - 3_600_000),
    ...over,
  });

  async function seedEvents(): Promise<void> {
    await prisma.securityEvent.createMany({
      data: [
        ev({}),
        ev({}),
        ev({ outcome: "blocked", ruleIds: ["destination_not_approved"] }),
        ev({ outcome: "blocked", ruleIds: ["destination_not_approved", "secret_detected"] }),
        ev({ outcome: "blocked", ruleIds: ["prohibited_file"], occurredAt: new Date(now - 2 * 86_400_000) }),
        ev({ outcome: "exception", ruleIds: ["destination_not_approved"] }),
        ev({ outcome: "error", ruleIds: ["internal_error"], projectId: null }),
        ev({ outcome: "blocked", ruleIds: ["secret_detected"], occurredAt: new Date(now - 20 * 86_400_000) }),
      ],
    });
  }
  const summary = (query = "") => request(http()).get(`/v1/metrics/summary${query}`).set("Cookie", admin);

  it("counts what is in the database for the range, not hard-coded numbers", async () => {
    await seedEvents();
    const week = (await summary()).body;
    expect(week.range).toBe("7d");
    expect(week.outcomes).toEqual({ allowed: 2, blocked: 3, error: 1, exception: 1 });
    expect(week.totalEvents).toBe(7);
    expect(week.topRules).toEqual([
      { ruleId: "destination_not_approved", count: 3 },
      { ruleId: "secret_detected", count: 1 },
      { ruleId: "prohibited_file", count: 1 },
      { ruleId: "internal_error", count: 1 },
    ].sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId)));

    const day = (await summary("?range=24h")).body;
    expect(day.outcomes).toEqual({ allowed: 2, blocked: 2, error: 1, exception: 1 });
    const month = (await summary("?range=30d")).body;
    expect(month.outcomes.blocked).toBe(4);
    expect(month.totalEvents).toBe(8);
  });

  it("breaks blocked pushes down per day and project", async () => {
    await seedEvents();
    const body = (await summary()).body;
    const today = new Date(now - 3_600_000).toISOString().slice(0, 10);
    expect(body.blockedPerDay).toContainEqual({ day: today, projectId, projectName: "payments", blocked: 2 });
    expect(body.blockedPerDay.reduce((n: number, r: { blocked: number }) => n + r.blocked, 0)).toBe(3);
  });

  it("lists the latest blocked pushes with names, newest first", async () => {
    await seedEvents();
    const { recentIncidents } = (await summary()).body;
    expect(recentIncidents.length).toBeGreaterThanOrEqual(3);
    expect(recentIncidents.every((e: { outcome: string }) => e.outcome === "blocked")).toBe(true);
    expect(recentIncidents[0]).toMatchObject({ deviceName: "alice-laptop", userName: "alice", projectName: "payments" });
    const times = recentIncidents.map((e: { occurredAt: string }) => e.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("counts pending exceptions and approvals in force", async () => {
    const ask = (repo: string) => request(http()).post("/v1/agent/exceptions").set("Authorization", alice.bearer).send({ projectId, destination: `https://github.com/customer/${repo}`, reason: "Customer asked for a copy in their repo" });
    const one = await ask("one");
    await ask("two");
    await request(http()).post(`/v1/exceptions/${one.body.id}/approve`).set("Cookie", admin).send({ reason: "Approved for the customer handover", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect((await summary()).body.exceptions).toEqual({ pending: 1, inForce: 1 });
    await prisma.exceptionDecision.updateMany({ where: { requestId: one.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await summary()).body.exceptions).toEqual({ pending: 1, inForce: 0 });
  });

  it("counts devices as active, stale (not heard from in 24 hours) and revoked", async () => {
    const bob = await enroll(app, await issueToken(app, admin, users.bob.id), "bob-laptop");
    const carol = await enroll(app, await issueToken(app, admin, users.alice.id), "alice-second");
    await prisma.device.update({ where: { id: alice.deviceId }, data: { lastSeenAt: new Date() } });
    await prisma.device.update({ where: { id: bob.deviceId }, data: { lastSeenAt: new Date(Date.now() - 3 * 86_400_000) } });
    await request(http()).post(`/v1/devices/${carol.deviceId}/revoke`).set("Cookie", admin);
    expect((await summary()).body.devices).toEqual({ active: 1, stale: 1, revoked: 1 });
  });

  it("is all zeros and empty on a fresh system, and admin-only", async () => {
    const body = (await summary()).body;
    expect(body.outcomes).toEqual({ allowed: 0, blocked: 0, error: 0, exception: 0 });
    expect(body.topRules).toEqual([]);
    expect(body.recentIncidents).toEqual([]);
    const aliceSession = await login(app, users.alice.email);
    expect((await request(http()).get("/v1/metrics/summary").set("Cookie", aliceSession)).status).toBe(403);
    expect((await request(http()).get("/v1/metrics/summary")).status).toBe(401);
    expect((await summary("?range=1y")).status).toBe(400);
  });
});
