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

describe.each([
  ["destinations", "destination.added", "destination.removed"],
  ["canonical-repos", "canonical_repo.added", "canonical_repo.removed"],
])("%s", (path, addedAction, removedAction) => {
  const url = (): string => `/v1/projects/${projectId}/${path}`;

  it.each([
    ["https://GitHub.com/Acme/Portal.git", "github.com", "acme/portal"],
    ["git@github.com:acme/portal", "github.com", "acme/portal"],
    ["ssh://git@git.example.test/team/app.git", "git.example.test", "team/app"],
  ])("stores %s in canonical form", async (input, host, repoPath) => {
    const res = await request(http()).post(url()).set("Cookie", admin).send({ url: input });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ host, repoPath });
    expect((await request(http()).get(url()).set("Cookie", admin)).body).toHaveLength(1);
    expect(await prisma.adminAuditEvent.count({ where: { action: addedAction, targetId: projectId } })).toBe(1);
  });

  it.each([
    ["userinfo disguising the host", "https://github.com@evil.example/acme/portal"],
    ["embedded credentials", "https://user:pw@github.com/acme/portal"],
    ["non-git scheme", "file:///etc/passwd"],
    ["ext transport", "ext::sh -c id"],
    ["query string", "https://github.com/acme/portal?x=1"],
    ["non-ASCII lookalike host", "https://githuб.com/acme/portal"],
    ["path traversal", "https://github.com/acme/../portal"],
    ["not a url", "hello"],
    ["empty", " "],
  ])("rejects %s with a 400 that names only a reason code", async (_name, input) => {
    const res = await request(http()).post(url()).set("Cookie", admin).send({ url: input });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_failed");
    expect(res.body.issues).toEqual([{ path: "url", code: expect.any(String) }]);
    expect(JSON.stringify(res.body)).not.toContain("passwd");
    expect(await prisma.adminAuditEvent.count({ where: { action: addedAction } })).toBe(0);
  });

  it("answers a duplicate with 409 (also when spelled differently)", async () => {
    await request(http()).post(url()).set("Cookie", admin).send({ url: "https://github.com/acme/portal" });
    expect((await request(http()).post(url()).set("Cookie", admin).send({ url: "git@GitHub.com:Acme/Portal.git" })).status).toBe(409);
  });

  it("removes an entry, audits it, and refuses ids from another project", async () => {
    const added = await request(http()).post(url()).set("Cookie", admin).send({ url: "https://github.com/acme/portal" });
    const other = await createProject(app, admin, "other");
    expect((await request(http()).delete(`/v1/projects/${other}/${path}/${added.body.id}`).set("Cookie", admin)).status).toBe(404);
    expect((await request(http()).delete(`${url()}/${added.body.id}`).set("Cookie", admin)).status).toBe(204);
    expect((await request(http()).get(url()).set("Cookie", admin)).body).toEqual([]);
    expect(await prisma.adminAuditEvent.count({ where: { action: removedAction } })).toBe(1);
    expect((await request(http()).delete(`${url()}/${added.body.id}`).set("Cookie", admin)).status).toBe(404);
  });

  it("is admin-only, 404 for an unknown project, 400 for a malformed body", async () => {
    const alice = await login(app, users.alice.email);
    expect((await request(http()).get(url()).set("Cookie", alice)).status).toBe(403);
    expect((await request(http()).post(url()).set("Cookie", alice).send({ url: "https://github.com/a/b" })).status).toBe(403);
    expect((await request(http()).post(`/v1/projects/00000000-0000-4000-8000-000000000000/${path}`).set("Cookie", admin).send({ url: "https://github.com/a/b" })).status).toBe(404);
    expect((await request(http()).post(url()).set("Cookie", admin).send({})).status).toBe(400);
  });
});
