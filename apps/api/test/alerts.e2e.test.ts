import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { AlertsService } from "../src/modules/alerts/alerts.service.js";
import { MAIL_SENDER, type MailMessage, type MailSender } from "../src/modules/alerts/mail-sender.js";
import { createProject, enroll, issueToken, login, seedUsers, startApp, type EnrolledDevice, type SeededUsers } from "./auth-harness.js";
import { createTestPrisma, resetData } from "./support.js";

const prisma = createTestPrisma();
let app: NestExpressApplication;
let users: SeededUsers;
let admin: string;
let alice: EnrolledDevice;
let projectId: string;
let send: MockInstance<MailSender["send"]>;

beforeAll(async () => {
  // SMTP_HOST selects the real adapter; its `send` is replaced below so nothing touches the network.
  app = await startApp({ SMTP_HOST: "127.0.0.1" });
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
  send = vi.spyOn(app.get<MailSender>(MAIL_SENDER, { strict: false }), "send").mockResolvedValue(undefined);
});

const http = (): ReturnType<NestExpressApplication["getHttpServer"]> => app.getHttpServer();
const settle = (): Promise<void> => app.get(AlertsService, { strict: false }).idle();
const sent = (): MailMessage[] => send.mock.calls.map(([m]) => m);

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
const post = (events: unknown[]) => request(http()).post("/v1/agent/events").set("Authorization", alice.bearer).send({ events });

describe("email alerts on ingested events", () => {
  it("mails every active security admin once for a blocked push, with metadata only", async () => {
    const res = await post([event({ findings: [{ ruleId: "github_token", kind: "secret", path: "src/private-file.ts", line: 4, commit: "b".repeat(40) }] })]);
    expect(res.status).toBe(200);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    const [m] = sent();
    expect(m?.to).toEqual([users.admin.email, users.admin2.email]);
    expect(m?.subject).toBe("[DevGuard] A push was blocked: payments");
    for (const part of ["alice", "alice-laptop", "github.com/personal/fork", "destination_not_approved", "http://localhost:5173/events"]) {
      expect(m?.text).toContain(part);
    }
    expect(m?.text).not.toContain("private-file");
    expect(m?.text).not.toContain("github_token");
  });

  it("mails for a secret or scan error event that was not blocked, but not for audit-only", async () => {
    await post([
      event({ outcome: "error", ruleIds: ["scan_error"], mode: null, wouldBlock: false }),
      event({ outcome: "allowed", ruleIds: ["secret_detected"], mode: "audit_only", wouldBlock: true }),
    ]);
    await settle();
    expect(sent().map((m) => m.subject)).toEqual(["[DevGuard] A high-severity push event was recorded: payments"]);
  });

  it("sends nothing for allowed, unprotected and audit-only events", async () => {
    await post([
      event({ outcome: "allowed", ruleIds: ["allowed"], wouldBlock: false }),
      event({ outcome: "allowed", ruleIds: ["unprotected_repo"], mode: null, wouldBlock: false, projectId: null }),
      event({ outcome: "allowed", ruleIds: ["destination_not_approved"], mode: "audit_only", wouldBlock: true }),
    ]);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not mail disabled admins or employees", async () => {
    await prisma.user.update({ where: { id: users.admin2.id }, data: { status: "disabled" } });
    await post([event()]);
    await settle();
    expect(sent()[0]?.to).toEqual([users.admin.email]);
  });

  it("does not mail again when the same batch is resubmitted (duplicates)", async () => {
    const e = event();
    await post([e]);
    await settle();
    await post([e]);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.securityEvent.count()).toBe(1);
  });

  it("does not mail for a rejected event (project the device owner is not assigned to)", async () => {
    const otherProject = await createProject(app, admin, "website");
    const res = await post([event({ projectId: otherProject })]);
    expect(res.body.results[0].status).toBe("rejected");
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it("mails without a project name when a blocked event has no project", async () => {
    await post([event({ projectId: null })]);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(sent()[0]?.subject).toBe("[DevGuard] A push was blocked: unmatched repository");
    expect(await prisma.securityEvent.count()).toBe(1);
  });

  it("sends nothing but still stores the event when there are no active admins", async () => {
    await prisma.user.updateMany({ where: { id: { in: [users.admin.id, users.admin2.id] } }, data: { status: "disabled" } });
    const res = await post([event()]);
    expect(res.status).toBe(200);
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.securityEvent.count()).toBe(1);
  });

  it("mails only for the accepted event when a batch mixes rejected and accepted ones", async () => {
    const otherProject = await createProject(app, admin, "website");
    const res = await post([event({ projectId: otherProject }), event()]);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(["rejected", "accepted"]);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(sent()[0]?.subject).toContain("payments");
  });

  it("still stores the event and answers 200 when sending fails", async () => {
    send.mockRejectedValue(new Error("smtp down"));
    const res = await post([event(), event()]);
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(["accepted", "accepted"]);
    await settle();
    expect(send).toHaveBeenCalledTimes(2); // one failure does not stop the next event's mail
    expect(await prisma.securityEvent.count()).toBe(2);
  });
});

describe("email alerts when SMTP is not configured", () => {
  it("accepts events and sends nothing", async () => {
    const plain = await startApp();
    try {
      const noop = vi.spyOn(plain.get<MailSender>(MAIL_SENDER, { strict: false }), "send");
      const res = await request(plain.getHttpServer()).post("/v1/agent/events").set("Authorization", alice.bearer).send({ events: [event()] });
      expect(res.status).toBe(200);
      await plain.get(AlertsService, { strict: false }).idle();
      expect(noop).not.toHaveBeenCalled();
    } finally {
      await plain.close();
    }
  });
});
