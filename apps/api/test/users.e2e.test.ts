import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PASSWORD, login, seedUsers, startApp, type SeededUsers } from "./auth-harness.js";
import { createTestPrisma, resetData } from "./support.js";

const prisma = createTestPrisma();
let app: NestExpressApplication;
let users: SeededUsers;

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
});

const newUser = { email: "carol@example.test", name: "Carol", password: ["Carol", "Pass", "98765"].join("-") };

describe("users", () => {
  it("lists users for an admin without any credential fields", async () => {
    const cookie = await login(app, users.admin.email);
    const res = await request(app.getHttpServer()).get("/v1/users").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash/i);
  });

  it("denies listing and creating to employees (403) and anonymous callers (401)", async () => {
    const cookie = await login(app, users.alice.email);
    expect((await request(app.getHttpServer()).get("/v1/users").set("Cookie", cookie)).status).toBe(403);
    expect((await request(app.getHttpServer()).post("/v1/users").set("Cookie", cookie).send(newUser)).status).toBe(403);
    expect((await request(app.getHttpServer()).get("/v1/users")).status).toBe(401);
    expect(await prisma.user.count({ where: { email: newUser.email } })).toBe(0);
  });

  it("creates a user who can then sign in, and writes an audit row without the password", async () => {
    const cookie = await login(app, users.admin.email);
    const res = await request(app.getHttpServer()).post("/v1/users").set("Cookie", cookie).send({ ...newUser, email: "Carol@Example.Test" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: "carol@example.test", isAdmin: false, status: "active" });
    expect(JSON.stringify(res.body)).not.toContain(newUser.password);

    expect((await request(app.getHttpServer()).post("/v1/auth/login").send({ email: newUser.email, password: newUser.password })).status).toBe(200);

    const audit = await prisma.adminAuditEvent.findMany({ where: { action: "user.created" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: users.admin.id, targetType: "user", targetId: res.body.id });
    expect(JSON.stringify(audit[0]?.summary)).not.toContain(newUser.password);
  });

  it("can create another admin", async () => {
    const cookie = await login(app, users.admin.email);
    const res = await request(app.getHttpServer()).post("/v1/users").set("Cookie", cookie).send({ ...newUser, isAdmin: true });
    expect(res.body.isAdmin).toBe(true);
  });

  it("answers a duplicate email with 409 and creates nothing", async () => {
    const cookie = await login(app, users.admin.email);
    const res = await request(app.getHttpServer()).post("/v1/users").set("Cookie", cookie).send({ ...newUser, email: users.alice.email });
    expect(res.status).toBe(409);
    expect(await prisma.user.count()).toBe(4);
  });

  it.each([
    ["short password", { ...newUser, password: "short" }],
    ["bad email", { ...newUser, email: "nope" }],
    ["unknown field", { ...newUser, role: "security_admin" }],
    ["missing name", { email: newUser.email, password: newUser.password }],
  ])("rejects %s with 400 and does not echo the password", async (_n, body) => {
    const cookie = await login(app, users.admin.email);
    const res = await request(app.getHttpServer()).post("/v1/users").set("Cookie", cookie).send(body);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    expect(JSON.stringify(res.body)).not.toContain(newUser.password);
  });
});
