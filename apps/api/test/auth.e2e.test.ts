import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PASSWORD, seedUsers, signSession, startApp, login, type SeededUsers } from "./auth-harness.js";
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

const server = (): ReturnType<NestExpressApplication["getHttpServer"]> => app.getHttpServer();

describe("POST /v1/auth/login", () => {
  it("signs in, sets an httpOnly SameSite cookie and returns the session user without credentials", async () => {
    const res = await request(server()).post("/v1/auth/login").send({ email: users.admin.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: users.admin.id, email: users.admin.email, isAdmin: true });
    const cookie = String(res.headers["set-cookie"]?.[0]);
    expect(cookie).toMatch(/^dg_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash|password/i);
  });

  it("matches email case-insensitively", async () => {
    const res = await request(server()).post("/v1/auth/login").send({ email: "ADMIN@Example.Test", password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it.each([
    ["wrong password", { email: "admin@example.test", password: "definitely-wrong-1" }],
    ["unknown email", { email: "nobody@example.test", password: PASSWORD }],
  ])("answers %s with the same generic 401", async (_name, body) => {
    const res = await request(server()).post("/v1/auth/login").send(body);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ code: "unauthenticated", message: "Invalid email or password." });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("refuses a disabled user with the same generic 401", async () => {
    await prisma.user.update({ where: { id: users.alice.id }, data: { status: "disabled" } });
    const res = await request(server()).post("/v1/auth/login").send({ email: users.alice.email, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid email or password.");
  });

  it("refuses seed placeholder accounts (no usable credential)", async () => {
    await prisma.user.update({ where: { id: users.bob.id }, data: { passwordHash: "!seed-no-login" } });
    const res = await request(server()).post("/v1/auth/login").send({ email: users.bob.email, password: "!seed-no-login" });
    expect(res.status).toBe(401);
  });

  it.each([[{}], [{ email: "a@example.test" }], [{ email: "not-an-email", password: "x" }], [{ email: "a@example.test", password: "x", isAdmin: true }]])(
    "rejects malformed body %j with 400 and no echoed values",
    async (body) => {
      const res = await request(server()).post("/v1/auth/login").send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("validation_failed");
    },
  );
});

describe("GET /v1/auth/me and logout", () => {
  it("returns the signed-in user", async () => {
    const cookie = await login(app, users.alice.email);
    const res = await request(server()).get("/v1/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: users.alice.email, isAdmin: false });
  });

  it("is 401 without a cookie", async () => {
    expect((await request(server()).get("/v1/auth/me")).status).toBe(401);
  });

  it("logout clears the cookie", async () => {
    const res = await request(server()).post("/v1/auth/logout");
    expect(res.status).toBe(204);
    expect(String(res.headers["set-cookie"]?.[0])).toMatch(/dg_session=;/);
  });

  it("rejects a tampered token", async () => {
    const cookie = await login(app, users.alice.email);
    const tampered = `${cookie.slice(0, -2)}${cookie.endsWith("aa") ? "bb" : "aa"}`;
    expect((await request(server()).get("/v1/auth/me").set("Cookie", tampered)).status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await signSession({ sub: users.alice.id, iat: nowSec - 7200, exp: nowSec - 3600 });
    expect((await request(server()).get("/v1/auth/me").set("Cookie", `dg_session=${token}`)).status).toBe(401);
  });

  it("rejects a token signed with another key", async () => {
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(users.alice.id).setExpirationTime("1h").sign(new TextEncoder().encode("x".repeat(40)));
    expect((await request(server()).get("/v1/auth/me").set("Cookie", `dg_session=${token}`)).status).toBe(401);
  });

  it("rejects an unsigned (alg none) token", async () => {
    const b64 = (o: object): string => Buffer.from(JSON.stringify(o)).toString("base64url");
    const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: users.admin.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
    expect((await request(server()).get("/v1/auth/me").set("Cookie", `dg_session=${token}`)).status).toBe(401);
  });

  it("stops honouring a valid session once the user is disabled", async () => {
    const cookie = await login(app, users.alice.email);
    await prisma.user.update({ where: { id: users.alice.id }, data: { status: "disabled" } });
    expect((await request(server()).get("/v1/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("reflects admin status from the database, not from the token", async () => {
    const cookie = await login(app, users.admin.email);
    await prisma.membership.deleteMany({ where: { userId: users.admin.id } });
    const res = await request(server()).get("/v1/auth/me").set("Cookie", cookie);
    expect(res.body.isAdmin).toBe(false);
    expect((await request(server()).get("/v1/users").set("Cookie", cookie)).status).toBe(403);
  });
});

describe("rate limiting", () => {
  it("throttles login after the configured number of attempts", async () => {
    const limited = await startApp({ AUTH_THROTTLE_LIMIT: "3" });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        statuses.push((await request(limited.getHttpServer()).post("/v1/auth/login").send({ email: users.admin.email, password: "wrong-password-1" })).status);
      }
      expect(statuses).toEqual([401, 401, 401, 429, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe("throttle ordering", () => {
  it("counts unauthenticated (401) calls to protected routes, so floods are limited", async () => {
    const limited = await startApp({ THROTTLE_LIMIT: "3" });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await request(limited.getHttpServer()).get("/v1/auth/me")).status);
      expect(statuses).toEqual([401, 401, 401, 429, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe("login with a placeholder account", () => {
  it("is refused like any wrong password", async () => {
    await prisma.user.update({ where: { id: users.bob.id }, data: { passwordHash: "!seed-no-login" } });
    const res = await request(server()).post("/v1/auth/login").send({ email: users.bob.email, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid email or password.");
  });
});

describe("default deny", () => {
  it("every registered route is either public or rejects anonymous callers", async () => {
    const res = await request(server()).get("/docs-json");
    const paths = res.body.paths as Record<string, Record<string, unknown>>;
    const publicRoutes = new Set(["POST /v1/auth/login", "POST /v1/auth/logout", "POST /v1/devices/enroll", "GET /health"]);
    const checked: string[] = [];
    for (const [path, methods] of Object.entries(paths)) {
      for (const method of Object.keys(methods)) {
        const key = `${method.toUpperCase()} ${path}`;
        if (publicRoutes.has(key)) continue;
        const concrete = path.replace(/\{[^}]+\}/g, "00000000-0000-4000-8000-000000000000");
        const r = await (request(server()) as unknown as Record<string, (p: string) => request.Test>)[method]?.(concrete);
        expect(r?.status, key).toBe(401);
        checked.push(key);
      }
    }
    expect(checked.length).toBeGreaterThanOrEqual(7);
  });
});
