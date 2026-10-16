import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProject, login, seedUsers, startApp, type SeededUsers } from "./auth-harness.js";
import { createTestPrisma, resetData } from "./support.js";

const prisma = createTestPrisma();
let app: NestExpressApplication;
let users: SeededUsers;
let admin: string;
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
  projectId = await createProject(app, admin);
});

const http = (): ReturnType<NestExpressApplication["getHttpServer"]> => app.getHttpServer();
const put = (body: unknown, cookie = admin) => request(http()).put(`/v1/projects/${projectId}/policy`).set("Cookie", cookie).send(body as object);
const update = { baseVersion: 1, mode: "audit_only", prohibitedGlobs: [".env", "*.pem"], secretRules: ["github_token"] };

describe("policy versions", () => {
  it("returns the current policy in the shared ProjectPolicy shape", async () => {
    await request(http()).post(`/v1/projects/${projectId}/destinations`).set("Cookie", admin).send({ url: "https://github.com/acme/portal" });
    await request(http()).post(`/v1/projects/${projectId}/canonical-repos`).set("Cookie", admin).send({ url: "https://github.com/acme/portal-mirror" });
    const res = await request(http()).get(`/v1/projects/${projectId}/policy`).set("Cookie", admin);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 1, mode: "enforce", classification: "confidential" });
    // The canonical repo is implicitly an approved destination.
    expect(res.body.destinations.map((d: { repoPath: string }) => d.repoPath).sort()).toEqual(["acme/portal", "acme/portal-mirror"]);
  });

  it("does not list a canonical repo twice when it is also an approved destination", async () => {
    for (const path of ["destinations", "canonical-repos"]) {
      await request(http()).post(`/v1/projects/${projectId}/${path}`).set("Cookie", admin).send({ url: "https://github.com/acme/portal" });
    }
    const res = await request(http()).get(`/v1/projects/${projectId}/policy`).set("Cookie", admin);
    expect(res.body.destinations).toHaveLength(1);
  });

  it("creates version N+1 from the current base, keeps history and audits before/after", async () => {
    const res = await put(update);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 2, mode: "audit_only", prohibitedGlobs: [".env", "*.pem"], secretRules: ["github_token"] });

    const versions = await request(http()).get(`/v1/projects/${projectId}/policy/versions`).set("Cookie", admin);
    expect(versions.body.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions.body[1]).toMatchObject({ mode: "enforce" });

    const audit = await prisma.adminAuditEvent.findFirstOrThrow({ where: { action: "policy.updated" } });
    expect(audit.actorId).toBe(users.admin.id);
    expect(audit.summary).toMatchObject({ fromVersion: 1, toVersion: 2, beforeMode: "enforce", afterMode: "audit_only", afterGlobs: 2, afterSecretRules: 1 });
  });

  it("answers a stale baseVersion with 409 and writes nothing", async () => {
    expect((await put(update)).status).toBe(200);
    const stale = await put({ ...update, baseVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("conflict");
    expect(await prisma.policyVersion.count({ where: { projectId } })).toBe(2);
  });

  it("lets exactly one of two concurrent edits from the same base win", async () => {
    const results = await Promise.all([put(update), put({ ...update, mode: "enforce" })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.policyVersion.count({ where: { projectId } })).toBe(2);
  });

  it("keeps versions immutable even against a direct database update", async () => {
    await put(update);
    await expect(prisma.policyVersion.updateMany({ where: { projectId }, data: { mode: "audit_only" } })).rejects.toThrow();
  });

  it.each([
    ["unknown secret rule", { ...update, secretRules: ["not_a_rule"] }],
    ["bad mode", { ...update, mode: "off" }],
    ["missing baseVersion", { mode: "enforce", prohibitedGlobs: [], secretRules: [] }],
    ["extra field", { ...update, destinations: [] }],
    ["empty glob", { ...update, prohibitedGlobs: [""] }],
  ])("rejects %s with 400", async (_name, body) => {
    expect((await put(body)).status).toBe(400);
    expect(await prisma.policyVersion.count({ where: { projectId } })).toBe(1);
  });

  it("is admin-only and 404 for an unknown project", async () => {
    const alice = await login(app, users.alice.email);
    expect((await put(update, alice)).status).toBe(403);
    expect((await request(http()).get(`/v1/projects/${projectId}/policy`).set("Cookie", alice)).status).toBe(403);
    expect((await request(http()).get("/v1/projects/00000000-0000-4000-8000-000000000000/policy").set("Cookie", admin)).status).toBe(404);
    expect((await request(http()).put("/v1/projects/00000000-0000-4000-8000-000000000000/policy").set("Cookie", admin).send(update)).status).toBe(404);
  });
});
