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
let admin2: string;
let aliceSession: string;
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
  admin2 = await login(app, users.admin2.email);
  aliceSession = await login(app, users.alice.email);
  alice = await enroll(app, await issueToken(app, admin, users.alice.id), "alice-laptop");
  bob = await enroll(app, await issueToken(app, admin, users.bob.id), "bob-laptop");
  projectId = await createProject(app, admin, "payments");
  otherProjectId = await createProject(app, admin, "website");
  await request(http()).put(`/v1/projects/${projectId}/members`).set("Cookie", admin).send({ userIds: [users.alice.id, users.bob.id] });
});

const http = (): ReturnType<NestExpressApplication["getHttpServer"]> => app.getHttpServer();
const REASON = "Customer asked for a copy in their own repository";
const DEST = "https://github.com/customer/portal-copy.git";
const inHours = (h: number): string => new Date(Date.now() + h * 3_600_000).toISOString();

const deviceRequest = (device: EnrolledDevice, over: Record<string, unknown> = {}) =>
  request(http()).post("/v1/agent/exceptions").set("Authorization", device.bearer).send({ projectId, destination: DEST, reason: REASON, ...over });
const approve = (cookie: string, id: string, over: Record<string, unknown> = {}) =>
  request(http()).post(`/v1/exceptions/${id}/approve`).set("Cookie", cookie).send({ reason: "Approved for the customer handover", expiresAt: inHours(24), ...over });
const validate = (device: EnrolledDevice | undefined, body: Record<string, unknown>) => {
  const req = request(http()).post("/v1/agent/exceptions/validate");
  if (device) req.set("Authorization", device.bearer);
  return req.send(body);
};
async function requested(device = alice, over: Record<string, unknown> = {}): Promise<string> {
  const res = await deviceRequest(device, over);
  expect(res.status).toBe(201);
  return res.body.id as string;
}
async function approved(over: Record<string, unknown> = {}): Promise<string> {
  const id = await requested();
  expect((await approve(admin, id, over)).status).toBe(200);
  return id;
}

describe("requesting", () => {
  it("creates a pending request from a device, with the destination normalised, and audits it", async () => {
    const res = await deviceRequest(alice);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ projectId, projectName: "payments", requesterId: users.alice.id, requesterName: "alice", deviceId: alice.deviceId, destination: { host: "github.com", repoPath: "customer/portal-copy" }, status: "pending", reason: REASON, decisions: [], expiresAt: null });
    expect(await prisma.adminAuditEvent.count({ where: { action: "exception.requested", actorId: users.alice.id, targetId: res.body.id } })).toBe(1);
  });

  it("also accepts a request from the requester's dashboard session (no device)", async () => {
    const res = await request(http()).post("/v1/exceptions").set("Cookie", aliceSession).send({ projectId, destination: DEST, reason: REASON });
    expect(res.status).toBe(201);
    expect(res.body.deviceId).toBeNull();
  });

  it("links the request to the requester's own event, and refuses someone else's or an unknown one", async () => {
    await request(http()).post("/v1/agent/events").set("Authorization", bob.bearer).send({ events: [{ idempotencyKey: "key-bob-0001", correlationId: "corr-bob-0001", occurredAt: "2026-06-01T12:00:00.000Z", projectId, destination: null, operation: "push", refs: [], outcome: "blocked", ruleIds: ["destination_not_approved"], findings: [], mode: "enforce", wouldBlock: true, policyVersion: 1, agentVersion: "0.1.0" }] });
    const bobsEvent = (await prisma.securityEvent.findFirstOrThrow()).id;
    expect((await deviceRequest(alice, { eventId: bobsEvent })).status).toBe(400);
    expect((await deviceRequest(alice, { eventId: randomUUID() })).status).toBe(400);
    const own = await deviceRequest(bob, { eventId: bobsEvent });
    expect(own.status).toBe(201);
    expect(own.body.eventId).toBe(bobsEvent);
  });

  it("refuses a project the requester is not assigned to and an unknown one in the same way (403), so ids cannot be probed", async () => {
    expect((await deviceRequest(alice, { projectId: otherProjectId })).status).toBe(403);
    expect((await deviceRequest(alice, { projectId: randomUUID() })).status).toBe(403);
    expect(await prisma.exceptionRequest.count()).toBe(0);
  });

  it.each([
    ["credentials in the URL", { destination: "https://user:pw@github.com/a/b" }],
    ["a non-git scheme", { destination: "file:///etc/passwd" }],
    ["a short reason", { reason: "because" }],
    ["a missing destination", { destination: undefined }],
    ["an unknown field (a claimed approval)", { status: "approved" }],
    ["a malformed project id", { projectId: "payments" }],
  ])("rejects %s with 400", async (_name, over) => {
    expect((await deviceRequest(alice, over)).status).toBe(400);
    expect(await prisma.exceptionRequest.count()).toBe(0);
  });

  it("lets exactly one of several simultaneous identical requests create a pending request", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => deviceRequest(alice)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await prisma.exceptionRequest.count({ where: { status: "pending" } })).toBe(1);
  });

  it("refuses a second pending request for the same destination (409) and too many pending ones", async () => {
    await requested();
    expect((await deviceRequest(alice)).status).toBe(409);
    await prisma.exceptionRequest.createMany({
      data: Array.from({ length: 19 }, (_, i) => ({ projectId, requesterId: users.alice.id, destHost: "github.com", destRepo: `customer/repo-${i}`, reason: REASON })),
    });
    const res = await deviceRequest(alice, { destination: "https://github.com/customer/one-more" });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain("too many pending");
  });

  it("needs a credential: anonymous, a wrong secret and a session on the device route are 401", async () => {
    expect((await request(http()).post("/v1/agent/exceptions").send({ projectId, destination: DEST, reason: REASON })).status).toBe(401);
    expect((await request(http()).post("/v1/agent/exceptions").set("Cookie", aliceSession).send({ projectId, destination: DEST, reason: REASON })).status).toBe(401);
    expect((await request(http()).post("/v1/exceptions").send({ projectId, destination: DEST, reason: REASON })).status).toBe(401);
  });
});

describe("deciding", () => {
  it("lets a different admin approve; records who, why and until when; audits it", async () => {
    const id = await requested();
    const res = await approve(admin, id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.decisions).toEqual([expect.objectContaining({ decision: "approved", deciderId: users.admin.id, deciderName: "admin", reason: "Approved for the customer handover" })]);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const audit = await prisma.adminAuditEvent.findFirstOrThrow({ where: { action: "exception.approved" } });
    expect(audit).toMatchObject({ actorId: users.admin.id, targetId: id });
    expect(audit.summary).toMatchObject({ projectId, host: "github.com", repoPath: "customer/portal-copy", requesterId: users.alice.id });
  });

  it("an admin cannot approve or reject their own request (approver != requester)", async () => {
    const res = await request(http()).post("/v1/exceptions").set("Cookie", admin).send({ projectId, destination: DEST, reason: REASON });
    expect(res.status).toBe(403); // an admin who is not assigned to the project cannot even request
    await request(http()).put(`/v1/projects/${projectId}/members`).set("Cookie", admin).send({ userIds: [users.alice.id, users.admin.id] });
    const own = await request(http()).post("/v1/exceptions").set("Cookie", admin).send({ projectId, destination: DEST, reason: REASON });
    expect(own.status).toBe(201);
    const selfApprove = await approve(admin, own.body.id);
    expect(selfApprove.status).toBe(403);
    expect(selfApprove.body.code).toBe("self_approval_forbidden");
    expect((await request(http()).post(`/v1/exceptions/${own.body.id}/reject`).set("Cookie", admin).send({ reason: "Rejecting my own request" })).status).toBe(403);
    expect((await approve(admin2, own.body.id)).status).toBe(200);
  });

  it("only an admin may decide: an employee gets 403 and nothing changes", async () => {
    const id = await requested();
    expect((await approve(aliceSession, id)).status).toBe(403);
    expect((await request(http()).post(`/v1/exceptions/${id}/reject`).set("Cookie", aliceSession).send({ reason: "Rejecting this one" })).status).toBe(403);
    expect((await request(http()).post(`/v1/exceptions/${id}/revoke`).set("Cookie", aliceSession).send({ reason: "Revoking this one" })).status).toBe(403);
    expect((await prisma.exceptionRequest.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
  });

  it.each([
    ["in the past", () => inHours(-1)],
    ["now", () => new Date().toISOString()],
    ["beyond the server cap (72 hours)", () => inHours(73)],
    ["not a date", () => "tomorrow"],
  ])("refuses an expiry %s with 400", async (_name, expiresAt) => {
    const id = await requested();
    expect((await approve(admin, id, { expiresAt: expiresAt() })).status).toBe(400);
    expect((await prisma.exceptionRequest.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
  });

  it("accepts an expiry right at the cap", async () => {
    const id = await requested();
    expect((await approve(admin, id, { expiresAt: inHours(71.9) })).status).toBe(200);
  });

  it("rejects with a reason, and a rejected request cannot be approved afterwards", async () => {
    const id = await requested();
    const res = await request(http()).post(`/v1/exceptions/${id}/reject`).set("Cookie", admin).send({ reason: "Use the approved mirror instead" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect((await approve(admin2, id)).status).toBe(409);
    expect((await validate(alice, { projectId, destination: DEST })).body).toEqual({ valid: false });
  });

  it("a decided request cannot be decided again (409), and unknown ids are 404", async () => {
    const id = await approved();
    expect((await approve(admin2, id)).status).toBe(409);
    expect((await approve(admin, randomUUID())).status).toBe(404);
    expect((await approve(admin, "nope")).status).toBe(400);
  });

  it("lets exactly one of two concurrent approvals win", async () => {
    const id = await requested();
    const results = await Promise.all([approve(admin, id), approve(admin2, id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.exceptionDecision.count({ where: { requestId: id } })).toBe(1);
  });

  it("revokes an approval that is in force, but not a pending request", async () => {
    const pending = await requested(alice, { destination: "https://github.com/customer/pending-one" });
    const revoke = (id: string) => request(http()).post(`/v1/exceptions/${id}/revoke`).set("Cookie", admin).send({ reason: "No longer needed after handover" });
    expect((await revoke(pending)).status).toBe(409);
    const id = await approved();
    const res = await revoke(id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("revoked");
    expect(await prisma.adminAuditEvent.count({ where: { action: "exception.revoked", targetId: id } })).toBe(1);
  });
});

describe("validation (what the agent asks at push time)", () => {
  it("is valid for the requester's device, project and destination while the approval lasts", async () => {
    const id = await approved();
    const res = await validate(alice, { projectId, destination: "git@github.com:Customer/Portal-Copy.git" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ valid: true, exceptionId: id, approverId: users.admin.id, requesterId: users.alice.id, waivedRuleIds: [] });
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("is not valid while pending", async () => {
    await requested();
    expect((await validate(alice, { projectId, destination: DEST })).body).toEqual({ valid: false });
  });

  it.each([
    ["another destination", { destination: "https://github.com/customer/other" }],
    ["a lookalike of the destination", { destination: "https://github.com.evil.example/customer/portal-copy" }],
    ["a sub-path of the destination", { destination: "https://github.com/customer/portal-copy/extra" }],
    ["a destination that does not parse", { destination: "not a url" }],
    ["another project", () => ({ projectId: otherProjectId })],
    ["an unknown project", () => ({ projectId: randomUUID() })],
  ])("is not valid for %s", async (_name, over) => {
    await approved();
    const res = await validate(alice, { projectId, destination: DEST, ...(typeof over === "function" ? over() : over) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false });
  });

  it("is not valid for anyone but the requester, even on the same project and destination", async () => {
    await approved();
    expect((await validate(bob, { projectId, destination: DEST })).body).toEqual({ valid: false });
  });

  it("is not valid once the requester is no longer assigned to the project", async () => {
    await approved();
    await request(http()).put(`/v1/projects/${projectId}/members`).set("Cookie", admin).send({ userIds: [users.bob.id] });
    expect((await validate(alice, { projectId, destination: DEST })).body).toEqual({ valid: false });
  });

  it("stops working when the approver is no longer an active admin (their authority is checked at use, not only at approval)", async () => {
    await approved();
    expect((await validate(alice, { projectId, destination: DEST })).body.valid).toBe(true);
    await prisma.membership.deleteMany({ where: { userId: users.admin.id } });
    expect((await validate(alice, { projectId, destination: DEST })).body).toEqual({ valid: false });
  });

  it("stops working when the approver's account is disabled", async () => {
    await approved();
    await prisma.user.update({ where: { id: users.admin.id }, data: { status: "disabled" } });
    expect((await validate(alice, { projectId, destination: DEST })).body).toEqual({ valid: false });
  });

  it("is not valid after revocation", async () => {
    const id = await approved();
    await request(http()).post(`/v1/exceptions/${id}/revoke`).set("Cookie", admin).send({ reason: "No longer needed after handover" });
    expect((await validate(alice, { projectId, destination: DEST })).body).toEqual({ valid: false });
  });

  it("is not valid after the expiry, decided by the server clock, with no background job", async () => {
    const id = await approved();
    await prisma.exceptionDecision.updateMany({ where: { requestId: id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await validate(alice, { projectId, destination: DEST })).body).toEqual({ valid: false });
    const listed = await request(http()).get(`/v1/exceptions/${id}`).set("Cookie", admin);
    expect(listed.body.status).toBe("expired");
    expect(listed.body.expiresAt).toBeNull();
  });

  it("stops at the exact expiry (boundary)", async () => {
    const id = await requested();
    await approve(admin, id, { expiresAt: new Date(Date.now() + 1500).toISOString() });
    expect((await validate(alice, { projectId, destination: DEST })).body.valid).toBe(true);
    await new Promise((r) => setTimeout(r, 1700));
    expect((await validate(alice, { projectId, destination: DEST })).body.valid).toBe(false);
  });

  it("ignores a self-approved record even if one is forced into the database", async () => {
    const id = await requested();
    await prisma.exceptionRequest.update({ where: { id }, data: { status: "approved" } });
    await prisma.exceptionDecision.create({ data: { requestId: id, deciderId: users.alice.id, decision: "approved", reason: "forged approval", expiresAt: new Date(Date.now() + 3_600_000) } });
    expect((await validate(alice, { projectId, destination: DEST })).body).toEqual({ valid: false });
  });

  it("picks the longest-lasting of several valid approvals", async () => {
    const first = await approved({ expiresAt: inHours(2) });
    await request(http()).post(`/v1/exceptions/${first}/revoke`).set("Cookie", admin).send({ reason: "Replacing it with a longer one" });
    const second = await approved({ expiresAt: inHours(48) });
    expect((await validate(alice, { projectId, destination: DEST })).body.exceptionId).toBe(second);
  });

  it("ignores any approval claim sent by the client: unknown fields are 400", async () => {
    await requested();
    for (const extra of [{ valid: true }, { approved: true }, { exceptionId: randomUUID() }, { status: "approved" }]) {
      expect((await validate(alice, { projectId, destination: DEST, ...extra })).status).toBe(400);
    }
  });

  it("needs a device credential: anonymous, a session and a revoked device are 401", async () => {
    await approved();
    expect((await validate(undefined, { projectId, destination: DEST })).status).toBe(401);
    expect((await request(http()).post("/v1/agent/exceptions/validate").set("Cookie", aliceSession).send({ projectId, destination: DEST })).status).toBe(401);
    await request(http()).post(`/v1/devices/${alice.deviceId}/revoke`).set("Cookie", admin);
    const revoked = await validate(alice, { projectId, destination: DEST });
    expect(revoked.status).toBe(401);
    expect(revoked.body.code).toBe("device_revoked");
  });
});

describe("reading", () => {
  it("shows admins every request and everyone else only their own", async () => {
    await requested(alice);
    await requested(bob);
    const adminList = await request(http()).get("/v1/exceptions").set("Cookie", admin);
    expect(adminList.body.total).toBe(2);
    const aliceList = await request(http()).get("/v1/exceptions").set("Cookie", aliceSession);
    expect(aliceList.body.total).toBe(1);
    expect(aliceList.body.items[0].requesterId).toBe(users.alice.id);
    const deviceList = await request(http()).get("/v1/agent/exceptions").set("Authorization", alice.bearer);
    expect(deviceList.body.items.map((e: { requesterId: string }) => e.requesterId)).toEqual([users.alice.id]);
  });

  it("filters by status, including the derived expired state, and by project", async () => {
    const live = await approved();
    const stale = await requested(alice, { destination: "https://github.com/customer/old" });
    await approve(admin, stale);
    await prisma.exceptionDecision.updateMany({ where: { requestId: stale }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await requested(bob);
    const ids = async (query: string) => (await request(http()).get(`/v1/exceptions${query}`).set("Cookie", admin)).body.items.map((e: { id: string }) => e.id);
    expect(await ids("?status=approved")).toEqual([live]);
    expect(await ids("?status=expired")).toEqual([stale]);
    expect(await ids("?status=pending")).toHaveLength(1);
    expect(await ids(`?projectId=${otherProjectId}`)).toEqual([]);
  });

  it("pages the approved and expired filters correctly beyond a handful of rows", async () => {
    const decided = await prisma.exceptionRequest.createManyAndReturn({
      data: Array.from({ length: 30 }, (_, i) => ({ projectId, requesterId: users.alice.id, destHost: "github.com", destRepo: `customer/r-${i}`, reason: REASON, status: "approved" as const })),
    });
    await prisma.exceptionDecision.createMany({
      data: decided.map((d, i) => ({ requestId: d.id, deciderId: users.admin.id, decision: "approved" as const, reason: "bulk approval for the test", expiresAt: new Date(Date.now() + (i < 12 ? 3_600_000 : -3_600_000)) })),
    });
    const query = async (q: string) => (await request(http()).get(`/v1/exceptions${q}`).set("Cookie", admin)).body;
    expect((await query("?status=approved&pageSize=5&page=1")).total).toBe(12);
    expect((await query("?status=approved&pageSize=5&page=3")).items).toHaveLength(2);
    expect((await query("?status=expired&pageSize=10&page=2")).items).toHaveLength(8);
    expect((await query("?status=expired")).total).toBe(18);
  });

  it("returns one request with its history to the requester or an admin, and 404 to anyone else", async () => {
    const id = await approved();
    expect((await request(http()).get(`/v1/exceptions/${id}`).set("Cookie", admin)).body.decisions).toHaveLength(1);
    expect((await request(http()).get(`/v1/exceptions/${id}`).set("Cookie", aliceSession)).status).toBe(200);
    const bobSession = await login(app, users.bob.email);
    expect((await request(http()).get(`/v1/exceptions/${id}`).set("Cookie", bobSession)).status).toBe(404);
    expect((await request(http()).get(`/v1/agent/exceptions/${id}`).set("Authorization", alice.bearer)).status).toBe(200);
    expect((await request(http()).get(`/v1/agent/exceptions/${id}`).set("Authorization", bob.bearer)).status).toBe(404);
  });

  it.each([["?status=nope"], ["?page=0"], ["?unknown=1"]])("rejects the bad query %s with 400", async (query) => {
    expect((await request(http()).get(`/v1/exceptions${query}`).set("Cookie", admin)).status).toBe(400);
  });
});
