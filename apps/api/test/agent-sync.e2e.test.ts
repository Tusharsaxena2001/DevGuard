import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AgentProjectSyncSchema } from "@devguard/shared";
import { createProject, enroll, issueToken, login, seedUsers, sha, startApp, type EnrolledDevice, type SeededUsers } from "./auth-harness.js";
import { createTestPrisma, resetData } from "./support.js";

const prisma = createTestPrisma();
let app: NestExpressApplication;
let users: SeededUsers;
let admin: string;
let alice: EnrolledDevice;
let bob: EnrolledDevice;
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
  bob = await enroll(app, await issueToken(app, admin, users.bob.id), "bob-laptop");
  projectId = await createProject(app, admin);
  await request(http()).put(`/v1/projects/${projectId}/members`).set("Cookie", admin).send({ userIds: [users.alice.id] });
  await request(http()).post(`/v1/projects/${projectId}/canonical-repos`).set("Cookie", admin).send({ url: "https://github.com/acme/portal" });
  await request(http()).post(`/v1/projects/${projectId}/destinations`).set("Cookie", admin).send({ url: "https://git.example.test/acme/portal" });
});

const http = (): ReturnType<NestExpressApplication["getHttpServer"]> => app.getHttpServer();
const sync = (device: EnrolledDevice, etag?: string) => {
  const req = request(http()).get("/v1/agent/projects").set("Authorization", device.bearer);
  return etag === undefined ? req : req.set("If-None-Match", etag);
};

describe("GET /v1/agent/projects", () => {
  it("returns the assigned project in the shared contract: policy, destinations, canonical repos, fingerprints", async () => {
    await request(http()).post(`/v1/projects/${projectId}/fingerprints`).set("Cookie", admin).send({ fingerprint: sha("a") });
    const res = await sync(alice);
    expect(res.status).toBe(200);
    const parsed = AgentProjectSyncSchema.parse(res.body);
    expect(parsed.projects).toHaveLength(1);
    const project = parsed.projects[0];
    expect(project).toMatchObject({ projectId, name: "payments", fingerprints: [sha("a")], canonicalRepos: [{ host: "github.com", repoPath: "acme/portal" }] });
    expect(project?.policy).toMatchObject({ version: 1, mode: "enforce", classification: "confidential" });
    expect(project?.policy.destinations.map((d) => `${d.host}/${d.repoPath}`).sort()).toEqual(["git.example.test/acme/portal", "github.com/acme/portal"]);
    expect(res.headers["etag"]).toMatch(/^"[0-9a-f]{32}"$/);
  });

  it("gives an unassigned employee's device nothing", async () => {
    const res = await sync(bob);
    expect(res.status).toBe(200);
    expect(res.body.projects).toEqual([]);
  });

  it("drops a project at the next sync after the assignment is removed, and adds it when assigned", async () => {
    await request(http()).put(`/v1/projects/${projectId}/members`).set("Cookie", admin).send({ userIds: [users.bob.id] });
    expect((await sync(alice)).body.projects).toEqual([]);
    expect((await sync(bob)).body.projects).toHaveLength(1);
  });

  it("answers 304 for an unchanged payload and a new ETag after a policy change", async () => {
    const first = await sync(alice);
    const etag = String(first.headers["etag"]);
    expect((await sync(alice, etag)).status).toBe(304);

    await request(http()).put(`/v1/projects/${projectId}/policy`).set("Cookie", admin).send({ baseVersion: 1, mode: "audit_only", prohibitedGlobs: [".env"], secretRules: [] });
    const second = await sync(alice, etag);
    expect(second.status).toBe(200);
    expect(second.body.projects[0].policy).toMatchObject({ version: 2, mode: "audit_only" });
    expect(second.headers["etag"]).not.toBe(etag);
  });

  it("changes the ETag when a destination or fingerprint changes", async () => {
    const etag = String((await sync(alice)).headers["etag"]);
    await request(http()).post(`/v1/projects/${projectId}/fingerprints`).set("Cookie", admin).send({ fingerprint: sha("b") });
    expect((await sync(alice, etag)).status).toBe(200);
  });

  it.each([
    ["no credential", undefined],
    ["a wrong secret", "wrong"],
  ])("refuses %s with 401", async (_name, kind) => {
    const req = request(http()).get("/v1/agent/projects");
    if (kind === "wrong") req.set("Authorization", `Bearer ${alice.deviceId}.dgs_wrong`);
    expect((await req).status).toBe(401);
  });

  it("refuses a revoked device and a dashboard session", async () => {
    await request(http()).post(`/v1/devices/${alice.deviceId}/revoke`).set("Cookie", admin);
    const revoked = await sync(alice);
    expect(revoked.status).toBe(401);
    expect(revoked.body.code).toBe("device_revoked");
    expect((await request(http()).get("/v1/agent/projects").set("Cookie", admin)).status).toBe(401);
  });

  it("never includes credentials, hashes or contents in the payload", async () => {
    expect(JSON.stringify((await sync(alice)).body)).not.toMatch(/secret(?!Rules)|hash|password|dgs_|dgt_/i);
  });
});

describe("POST /v1/agent/repo-fingerprints", () => {
  const report = (device: EnrolledDevice, body: object) => request(http()).post("/v1/agent/repo-fingerprints").set("Authorization", device.bearer).send(body);

  it("records a fingerprint for an assigned device whose remote matches the project, and syncs it", async () => {
    const res = await report(alice, { projectId, fingerprint: sha("c"), remote: "git@github.com:Acme/Portal.git" });
    expect(res.status).toBe(204);
    const row = await prisma.projectFingerprint.findFirstOrThrow({ where: { projectId } });
    expect(row).toMatchObject({ fingerprint: sha("c"), source: "device", reportedByDeviceId: alice.deviceId });
    expect((await sync(alice)).body.projects[0].fingerprints).toEqual([sha("c")]);
    expect(await prisma.adminAuditEvent.count({ where: { action: "fingerprint.reported" } })).toBe(1);
  });

  it("is idempotent and audits only the first report", async () => {
    await report(alice, { projectId, fingerprint: sha("c"), remote: "https://github.com/acme/portal" });
    expect((await report(alice, { projectId, fingerprint: sha("c"), remote: "https://github.com/acme/portal" })).status).toBe(204);
    expect(await prisma.projectFingerprint.count()).toBe(1);
    expect(await prisma.adminAuditEvent.count({ where: { action: "fingerprint.reported" } })).toBe(1);
  });

  it("refuses an unassigned device", async () => {
    expect((await report(bob, { projectId, fingerprint: sha("c"), remote: "https://github.com/acme/portal" })).status).toBe(403);
    expect(await prisma.projectFingerprint.count()).toBe(0);
  });

  it.each([
    ["a remote of another repo", "https://github.com/acme/other"],
    ["a lookalike host", "https://github.com.evil.example/acme/portal"],
    ["a userinfo trick", "https://github.com@evil.example/acme/portal"],
  ])("refuses %s", async (_name, remote) => {
    const res = await report(alice, { projectId, fingerprint: sha("c"), remote });
    expect([400, 403]).toContain(res.status);
    expect(await prisma.projectFingerprint.count()).toBe(0);
  });

  it("refuses an unknown project like an unassigned one, and malformed bodies with 400", async () => {
    expect((await report(alice, { projectId: "00000000-0000-4000-8000-000000000000", fingerprint: sha("c"), remote: "https://github.com/acme/portal" })).status).toBe(403);
    expect((await report(alice, { projectId, fingerprint: "not-a-sha", remote: "https://github.com/acme/portal" })).status).toBe(400);
    expect((await report(alice, { projectId, fingerprint: sha("c"), remote: "https://github.com/acme/portal", extra: 1 })).status).toBe(400);
  });

  it("stops accepting fingerprints at the per-project limit so a device cannot break sync for the others", async () => {
    await prisma.projectFingerprint.createMany({
      data: Array.from({ length: 1000 }, (_, i) => ({ projectId, fingerprint: i.toString(16).padStart(40, "0"), source: "manual" as const })),
    });
    expect((await report(alice, { projectId, fingerprint: sha("f"), remote: "https://github.com/acme/portal" })).status).toBe(409);
    expect((await request(http()).post(`/v1/projects/${projectId}/fingerprints`).set("Cookie", admin).send({ fingerprint: sha("f") })).status).toBe(409);
    // The sync body still parses for every member.
    expect(AgentProjectSyncSchema.safeParse((await sync(alice)).body).success).toBe(true);
    expect(await prisma.projectFingerprint.count()).toBe(1000);
  });

  it("lets an admin see and remove a device-reported fingerprint, which then stops syncing", async () => {
    await report(alice, { projectId, fingerprint: sha("c"), remote: "https://github.com/acme/portal" });
    const list = await request(http()).get(`/v1/projects/${projectId}/fingerprints`).set("Cookie", admin);
    expect(list.body).toEqual([expect.objectContaining({ fingerprint: sha("c"), source: "device", reportedByDeviceId: alice.deviceId })]);
    expect((await request(http()).delete(`/v1/projects/${projectId}/fingerprints/${list.body[0].id}`).set("Cookie", admin)).status).toBe(204);
    expect((await sync(alice)).body.projects[0].fingerprints).toEqual([]);
    expect(await prisma.adminAuditEvent.count({ where: { action: "fingerprint.removed" } })).toBe(1);
  });

  it("a user session cannot use the device endpoint", async () => {
    const res = await request(http()).post("/v1/agent/repo-fingerprints").set("Cookie", admin).send({ projectId, fingerprint: sha("c"), remote: "https://github.com/acme/portal" });
    expect(res.status).toBe(401);
  });
});

describe("manual fingerprints and repo registration", () => {
  it("adds a manual fingerprint once (409 on repeat) and rejects malformed ones", async () => {
    const add = (fingerprint: string) => request(http()).post(`/v1/projects/${projectId}/fingerprints`).set("Cookie", admin).send({ fingerprint });
    expect((await add(sha("d"))).status).toBe(201);
    expect((await add(sha("d"))).status).toBe(409);
    expect((await add("xyz")).status).toBe(400);
  });

  it("registers a repo for an assigned device and shows it to admins; unassigned devices are refused", async () => {
    const register = (device: EnrolledDevice) => request(http()).post(`/v1/projects/${projectId}/repos`).set("Authorization", device.bearer).send({ fingerprint: sha("e") });
    expect((await register(alice)).status).toBe(204);
    expect((await register(alice)).status).toBe(204);
    expect((await register(bob)).status).toBe(403);
    const list = await request(http()).get(`/v1/projects/${projectId}/repos`).set("Cookie", admin);
    expect(list.body).toEqual([expect.objectContaining({ deviceId: alice.deviceId, deviceName: "alice-laptop", fingerprint: sha("e") })]);
    expect(await prisma.adminAuditEvent.count({ where: { action: "repo.registered" } })).toBe(1);
  });

  it("an employee session cannot list registrations", async () => {
    const aliceSession = await login(app, users.alice.email);
    expect((await request(http()).get(`/v1/projects/${projectId}/repos`).set("Cookie", aliceSession)).status).toBe(403);
    expect((await request(http()).get(`/v1/projects/${projectId}/fingerprints`).set("Cookie", aliceSession)).status).toBe(403);
  });
});
