import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enroll, issueToken, login, seedUsers, startApp, type SeededUsers } from "./auth-harness.js";
import { createTestPrisma, resetData } from "./support.js";

const prisma = createTestPrisma();
let app: NestExpressApplication;
let users: SeededUsers;
let adminCookie: string;

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
  adminCookie = await login(app, users.admin.email);
});

const http = (): ReturnType<NestExpressApplication["getHttpServer"]> => app.getHttpServer();
const enrollBody = (token: string): Record<string, string> => ({ token, deviceName: "laptop", os: "linux", agentVersion: "0.1.0" });

describe("enrollment tokens", () => {
  it("an admin issues a token once; only its hash is stored and the audit row omits it", async () => {
    const res = await request(http()).post("/v1/devices/enrollment-tokens").set("Cookie", adminCookie).send({ userId: users.alice.id });
    expect(res.status).toBe(201);
    const token = res.body.token as string;
    expect(token).toMatch(/^dgt_/);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const rows = await prisma.enrollmentToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(token);
    expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]).toMatchObject({ userId: users.alice.id, createdBy: users.admin.id, usedAt: null });

    const audit = await prisma.adminAuditEvent.findMany({ where: { action: "device.enrollment_token_issued" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain(token);
  });

  it("is denied to employees (403) and anonymous callers (401)", async () => {
    const alice = await login(app, users.alice.email);
    expect((await request(http()).post("/v1/devices/enrollment-tokens").set("Cookie", alice).send({ userId: users.alice.id })).status).toBe(403);
    expect((await request(http()).post("/v1/devices/enrollment-tokens").send({ userId: users.alice.id })).status).toBe(401);
    expect(await prisma.enrollmentToken.count()).toBe(0);
  });

  it("refuses an unknown user (404) and a disabled user (404), and malformed bodies (400)", async () => {
    expect((await request(http()).post("/v1/devices/enrollment-tokens").set("Cookie", adminCookie).send({ userId: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
    await prisma.user.update({ where: { id: users.bob.id }, data: { status: "disabled" } });
    expect((await request(http()).post("/v1/devices/enrollment-tokens").set("Cookie", adminCookie).send({ userId: users.bob.id })).status).toBe(404);
    expect((await request(http()).post("/v1/devices/enrollment-tokens").set("Cookie", adminCookie).send({})).status).toBe(400);
    expect((await request(http()).post("/v1/devices/enrollment-tokens").set("Cookie", adminCookie).send({ userId: "not-a-uuid" })).status).toBe(400);
  });
});

describe("enroll", () => {
  it("creates a device owned by the token's user and returns the secret once, stored only as a hash", async () => {
    const token = await issueToken(app, adminCookie, users.alice.id);
    const res = await request(http()).post("/v1/devices/enroll").send(enrollBody(token));
    expect(res.status).toBe(201);
    const { deviceId, deviceSecret } = res.body as { deviceId: string; deviceSecret: string };
    expect(deviceSecret).toMatch(/^dgs_/);

    const device = await prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device).toMatchObject({ userId: users.alice.id, name: "laptop", os: "linux", status: "active" });
    expect(device.secretHash).not.toBe(deviceSecret);
    expect(device.secretHash).toMatch(/^[0-9a-f]{64}$/);

    const audit = await prisma.adminAuditEvent.findMany({ where: { action: "device.enrolled" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(deviceSecret);
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it("rejects a reused token with the generic enrollment error", async () => {
    const token = await issueToken(app, adminCookie, users.alice.id);
    expect((await request(http()).post("/v1/devices/enroll").send(enrollBody(token))).status).toBe(201);
    const again = await request(http()).post("/v1/devices/enroll").send(enrollBody(token));
    expect(again.status).toBe(400);
    expect(again.body).toEqual({ code: "enrollment_token_invalid", message: "The enrollment token is invalid or expired." });
    expect(await prisma.device.count()).toBe(1);
  });

  it("rejects an expired token and an unknown token with the same answer", async () => {
    const token = await issueToken(app, adminCookie, users.alice.id);
    await prisma.enrollmentToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await request(http()).post("/v1/devices/enroll").send(enrollBody(token));
    const unknown = await request(http()).post("/v1/devices/enroll").send(enrollBody("dgt_unknown-token"));
    expect(expired.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(expired.body).toEqual(unknown.body);
    expect(await prisma.device.count()).toBe(0);
    expect((await prisma.enrollmentToken.findFirstOrThrow()).usedAt).toBeNull();
  });

  it("does not enroll a device for a user disabled after the token was issued", async () => {
    const token = await issueToken(app, adminCookie, users.alice.id);
    await prisma.user.update({ where: { id: users.alice.id }, data: { status: "disabled" } });
    const res = await request(http()).post("/v1/devices/enroll").send(enrollBody(token));
    expect(res.status).toBe(400);
    expect(await prisma.device.count()).toBe(0);
    expect(await prisma.adminAuditEvent.count({ where: { action: "device.enrolled" } })).toBe(0);
  });

  it("lets exactly one of several concurrent enrollments with one token win", async () => {
    const token = await issueToken(app, adminCookie, users.alice.id);
    const results = await Promise.all(Array.from({ length: 5 }, () => request(http()).post("/v1/devices/enroll").send(enrollBody(token))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(4);
    expect(await prisma.device.count()).toBe(1);
  });

  it.each([[{}], [{ token: "t" }], [{ token: "", deviceName: "d", os: "o", agentVersion: "1" }], [{ token: "t", deviceName: "d", os: "o", agentVersion: "1", userId: "x" }]])(
    "rejects malformed body %j with 400",
    async (body) => {
      expect((await request(http()).post("/v1/devices/enroll").send(body)).status).toBe(400);
    },
  );

  it("is rate limited", async () => {
    const limited = await startApp({ AUTH_THROTTLE_LIMIT: "2" });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push((await request(limited.getHttpServer()).post("/v1/devices/enroll").send(enrollBody("dgt_x"))).status);
      expect(statuses).toEqual([400, 400, 429, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe("device authentication and heartbeat", () => {
  it("accepts a valid credential and records lastSeenAt and the agent version", async () => {
    const device = await enroll(app, await issueToken(app, adminCookie, users.alice.id));
    const res = await request(http()).post("/v1/devices/heartbeat").set("Authorization", device.bearer).send({ agentVersion: "0.2.0" });
    expect(res.status).toBe(204);
    const row = await prisma.device.findUniqueOrThrow({ where: { id: device.deviceId } });
    expect(row.lastSeenAt).not.toBeNull();
    expect(row.agentVersion).toBe("0.2.0");
  });

  it.each([
    ["no header", undefined],
    ["wrong scheme", "Basic abc"],
    ["no separator", "Bearer nodotvalue"],
    ["unknown device", "Bearer 00000000-0000-4000-8000-000000000000.dgs_whatever"],
    ["non-uuid id", "Bearer not-a-uuid.dgs_whatever"],
  ])("rejects %s with 401", async (_n, header) => {
    const req = request(http()).post("/v1/devices/heartbeat");
    if (header !== undefined) req.set("Authorization", header);
    const res = await req.send({ agentVersion: "0.1.0" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("unauthenticated");
  });

  it("rejects a wrong secret for a real device with the same generic 401", async () => {
    const device = await enroll(app, await issueToken(app, adminCookie, users.alice.id));
    const res = await request(http()).post("/v1/devices/heartbeat").set("Authorization", `Bearer ${device.deviceId}.dgs_wrong`).send({ agentVersion: "0.1.0" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("unauthenticated");
  });

  it("rejects the seed placeholder secret", async () => {
    const device = await prisma.device.create({
      data: { userId: users.alice.id, name: "seed", os: "linux", agentVersion: "0", secretHash: "!seed-no-device-secret" },
    });
    const res = await request(http()).post("/v1/devices/heartbeat").set("Authorization", `Bearer ${device.id}.!seed-no-device-secret`).send({ agentVersion: "0.1.0" });
    expect(res.status).toBe(401);
  });

  it("a device credential cannot call user routes, and a user session cannot call device routes", async () => {
    const device = await enroll(app, await issueToken(app, adminCookie, users.alice.id));
    for (const path of ["/v1/auth/me", "/v1/devices", "/v1/users"]) {
      expect((await request(http()).get(path).set("Authorization", device.bearer)).status, path).toBe(401);
    }
    expect((await request(http()).post(`/v1/devices/${device.deviceId}/revoke`).set("Authorization", device.bearer)).status).toBe(401);
    expect((await request(http()).post("/v1/devices/heartbeat").set("Cookie", adminCookie).send({ agentVersion: "0.1.0" })).status).toBe(401);
  });

  it("stops working when the owner is disabled", async () => {
    const device = await enroll(app, await issueToken(app, adminCookie, users.alice.id));
    await prisma.user.update({ where: { id: users.alice.id }, data: { status: "disabled" } });
    expect((await request(http()).post("/v1/devices/heartbeat").set("Authorization", device.bearer).send({ agentVersion: "0.1.0" })).status).toBe(401);
  });

  it("rejects an invalid heartbeat body with 400", async () => {
    const device = await enroll(app, await issueToken(app, adminCookie, users.alice.id));
    expect((await request(http()).post("/v1/devices/heartbeat").set("Authorization", device.bearer).send({})).status).toBe(400);
  });
});

describe("listing, reading and revoking", () => {
  it("scopes the list: admins see all devices, employees only their own", async () => {
    await enroll(app, await issueToken(app, adminCookie, users.alice.id), "alice-laptop");
    await enroll(app, await issueToken(app, adminCookie, users.bob.id), "bob-laptop");
    const asAdmin = await request(http()).get("/v1/devices").set("Cookie", adminCookie);
    expect(asAdmin.body.map((d: { name: string }) => d.name).sort()).toEqual(["alice-laptop", "bob-laptop"]);
    const aliceCookie = await login(app, users.alice.email);
    const asAlice = await request(http()).get("/v1/devices").set("Cookie", aliceCookie);
    expect(asAlice.body.map((d: { name: string }) => d.name)).toEqual(["alice-laptop"]);
    expect(JSON.stringify([asAdmin.body, asAlice.body])).not.toMatch(/secretHash|dgs_/);
  });

  it("reports another user's device as 404 to an employee, but shows it to the owner and an admin", async () => {
    const bobDevice = await enroll(app, await issueToken(app, adminCookie, users.bob.id));
    const alice = await login(app, users.alice.email);
    expect((await request(http()).get(`/v1/devices/${bobDevice.deviceId}`).set("Cookie", alice)).status).toBe(404);
    const bob = await login(app, users.bob.email);
    expect((await request(http()).get(`/v1/devices/${bobDevice.deviceId}`).set("Cookie", bob)).status).toBe(200);
    expect((await request(http()).get(`/v1/devices/${bobDevice.deviceId}`).set("Cookie", adminCookie)).status).toBe(200);
  });

  it("answers an unknown id with 404 and a malformed id with 400", async () => {
    expect((await request(http()).get("/v1/devices/00000000-0000-4000-8000-000000000000").set("Cookie", adminCookie)).status).toBe(404);
    expect((await request(http()).get("/v1/devices/not-a-uuid").set("Cookie", adminCookie)).status).toBe(400);
  });

  it("revokes a device (admin only): its next call is 401 device_revoked and the audit row is written once", async () => {
    const device = await enroll(app, await issueToken(app, adminCookie, users.alice.id));
    const alice = await login(app, users.alice.email);
    expect((await request(http()).post(`/v1/devices/${device.deviceId}/revoke`).set("Cookie", alice)).status).toBe(403);
    expect((await request(http()).post("/v1/devices/heartbeat").set("Authorization", device.bearer).send({ agentVersion: "0.1.0" })).status).toBe(204);

    const revoked = await request(http()).post(`/v1/devices/${device.deviceId}/revoke`).set("Cookie", adminCookie);
    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({ status: "revoked" });
    expect(revoked.body.revokedAt).not.toBeNull();
    // Revoking again is harmless and not audited twice.
    expect((await request(http()).post(`/v1/devices/${device.deviceId}/revoke`).set("Cookie", adminCookie)).status).toBe(200);
    expect(await prisma.adminAuditEvent.count({ where: { action: "device.revoked" } })).toBe(1);

    const after = await request(http()).post("/v1/devices/heartbeat").set("Authorization", device.bearer).send({ agentVersion: "0.1.0" });
    expect(after.status).toBe(401);
    expect(after.body.code).toBe("device_revoked");
  });

  it("does not reveal revocation to someone without the right secret", async () => {
    const device = await enroll(app, await issueToken(app, adminCookie, users.alice.id));
    await request(http()).post(`/v1/devices/${device.deviceId}/revoke`).set("Cookie", adminCookie);
    const res = await request(http()).post("/v1/devices/heartbeat").set("Authorization", `Bearer ${device.deviceId}.dgs_guess`).send({ agentVersion: "0.1.0" });
    expect(res.body.code).toBe("unauthenticated");
  });

  it("revoking an unknown device is 404", async () => {
    expect((await request(http()).post("/v1/devices/00000000-0000-4000-8000-000000000000/revoke").set("Cookie", adminCookie)).status).toBe(404);
  });
});
