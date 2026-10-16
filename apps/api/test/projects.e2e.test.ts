import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProject, login, seedUsers, startApp, type SeededUsers } from "./auth-harness.js";
import { createTestPrisma, resetData } from "./support.js";

const prisma = createTestPrisma();
let app: NestExpressApplication;
let users: SeededUsers;
let admin: string;

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
});

const http = (): ReturnType<NestExpressApplication["getHttpServer"]> => app.getHttpServer();

describe("projects", () => {
  it("creates a project with its first policy version (enforce, default globs and secret rules) and audits it", async () => {
    const res = await request(http()).post("/v1/projects").set("Cookie", admin).send({ name: "payments", classification: "confidential" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "payments", classification: "confidential", ownerId: users.admin.id, memberIds: [] });

    const versions = await prisma.policyVersion.findMany({ where: { projectId: res.body.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, mode: "enforce" });
    expect(versions[0]?.prohibitedGlobs.length).toBeGreaterThan(0);
    expect((versions[0]?.secretRules as string[]).length).toBeGreaterThan(0);
    expect(await prisma.adminAuditEvent.count({ where: { action: "project.created", targetId: res.body.id, actorId: users.admin.id } })).toBe(1);
  });

  it("rejects a duplicate name (409), bad bodies (400), employees (403) and anonymous callers (401)", async () => {
    await createProject(app, admin, "payments");
    expect((await request(http()).post("/v1/projects").set("Cookie", admin).send({ name: "payments", classification: "internal" })).status).toBe(409);
    expect((await request(http()).post("/v1/projects").set("Cookie", admin).send({ name: "", classification: "internal" })).status).toBe(400);
    expect((await request(http()).post("/v1/projects").set("Cookie", admin).send({ name: "x", classification: "secret" })).status).toBe(400);
    const alice = await login(app, users.alice.email);
    expect((await request(http()).post("/v1/projects").set("Cookie", alice).send({ name: "y", classification: "internal" })).status).toBe(403);
    expect((await request(http()).get("/v1/projects").set("Cookie", alice)).status).toBe(403);
    expect((await request(http()).get("/v1/projects")).status).toBe(401);
  });

  it("lists and reads projects; unknown id is 404, malformed id is 400", async () => {
    const id = await createProject(app, admin, "payments");
    expect((await request(http()).get("/v1/projects").set("Cookie", admin)).body).toHaveLength(1);
    expect((await request(http()).get(`/v1/projects/${id}`).set("Cookie", admin)).body.id).toBe(id);
    expect((await request(http()).get("/v1/projects/00000000-0000-4000-8000-000000000000").set("Cookie", admin)).status).toBe(404);
    expect((await request(http()).get("/v1/projects/nope").set("Cookie", admin)).status).toBe(400);
  });

  it("renames and reclassifies with a before/after audit row; refuses empty patches and name clashes", async () => {
    const id = await createProject(app, admin, "payments", "internal");
    await createProject(app, admin, "website");
    const res = await request(http()).patch(`/v1/projects/${id}`).set("Cookie", admin).send({ name: "payments-v2", classification: "client_owned" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "payments-v2", classification: "client_owned" });
    const audit = await prisma.adminAuditEvent.findFirstOrThrow({ where: { action: "project.updated" } });
    expect(audit.summary).toMatchObject({ beforeName: "payments", afterName: "payments-v2", beforeClassification: "internal", afterClassification: "client_owned" });
    expect((await request(http()).patch(`/v1/projects/${id}`).set("Cookie", admin).send({})).status).toBe(400);
    expect((await request(http()).patch(`/v1/projects/${id}`).set("Cookie", admin).send({ name: "website" })).status).toBe(409);
    expect((await request(http()).patch("/v1/projects/00000000-0000-4000-8000-000000000000").set("Cookie", admin).send({ name: "z" })).status).toBe(404);
  });
});

describe("assignments", () => {
  it("replaces the assigned employees and audits additions and removals", async () => {
    const id = await createProject(app, admin);
    const set = async (userIds: string[]) => request(http()).put(`/v1/projects/${id}/members`).set("Cookie", admin).send({ userIds });

    const first = await set([users.alice.id, users.bob.id]);
    expect(first.status).toBe(200);
    expect([...first.body.memberIds].sort()).toEqual([users.alice.id, users.bob.id].sort());

    const second = await set([users.bob.id]);
    expect(second.body.memberIds).toEqual([users.bob.id]);
    const audits = await prisma.adminAuditEvent.findMany({ where: { action: "project.members_changed" }, orderBy: { occurredAt: "asc" } });
    expect(audits).toHaveLength(2);
    expect(audits[1]?.summary).toMatchObject({ removed: users.alice.id, added: "" });

    await set([users.bob.id]); // unchanged: no extra audit row
    expect(await prisma.adminAuditEvent.count({ where: { action: "project.members_changed" } })).toBe(2);
  });

  it("refuses unknown and disabled users without changing anything", async () => {
    const id = await createProject(app, admin);
    await prisma.user.update({ where: { id: users.bob.id }, data: { status: "disabled" } });
    const unknown = await request(http()).put(`/v1/projects/${id}/members`).set("Cookie", admin).send({ userIds: ["00000000-0000-4000-8000-000000000000"] });
    const disabled = await request(http()).put(`/v1/projects/${id}/members`).set("Cookie", admin).send({ userIds: [users.bob.id] });
    expect(unknown.status).toBe(400);
    expect(disabled.status).toBe(400);
    expect(await prisma.membership.count({ where: { projectId: id } })).toBe(0);
  });

  it("is admin-only and 404 for an unknown project", async () => {
    const id = await createProject(app, admin);
    const alice = await login(app, users.alice.email);
    expect((await request(http()).put(`/v1/projects/${id}/members`).set("Cookie", alice).send({ userIds: [users.alice.id] })).status).toBe(403);
    expect((await request(http()).put("/v1/projects/00000000-0000-4000-8000-000000000000/members").set("Cookie", admin).send({ userIds: [] })).status).toBe(404);
  });
});
