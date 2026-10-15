import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestPrisma, resetData } from "./support.js";

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => resetData(prisma));

async function makeUser(email = "u@example.test"): Promise<string> {
  return (await prisma.user.create({ data: { email, name: "U", passwordHash: "!test" } })).id;
}
async function makeProject(ownerId: string, name = "p"): Promise<string> {
  return (await prisma.project.create({ data: { name, classification: "internal", ownerId } })).id;
}

describe("constraints", () => {
  it("rejects a duplicate user email", async () => {
    await makeUser("dup@example.test");
    await expect(makeUser("dup@example.test")).rejects.toThrow();
  });

  it("rejects a duplicate project name", async () => {
    const owner = await makeUser();
    await makeProject(owner, "same");
    await expect(makeProject(owner, "same")).rejects.toThrow();
  });

  it("rejects a duplicate project-scoped membership", async () => {
    const user = await makeUser();
    const project = await makeProject(user);
    await prisma.membership.create({ data: { userId: user, role: "team_lead", projectId: project } });
    await expect(prisma.membership.create({ data: { userId: user, role: "team_lead", projectId: project } })).rejects.toThrow();
  });

  it("rejects a duplicate GLOBAL membership (null projectId) via the partial unique index", async () => {
    const user = await makeUser();
    await prisma.membership.create({ data: { userId: user, role: "security_admin", projectId: null } });
    await expect(prisma.membership.create({ data: { userId: user, role: "security_admin", projectId: null } })).rejects.toThrow();
    // A different role, or the same role in a project, is fine.
    const project = await makeProject(user);
    await prisma.membership.create({ data: { userId: user, role: "employee", projectId: null } });
    await prisma.membership.create({ data: { userId: user, role: "security_admin", projectId: project } });
  });

  it("rejects a duplicate approved destination per project, but allows it in another project", async () => {
    const owner = await makeUser();
    const a = await makeProject(owner, "a");
    const b = await makeProject(owner, "b");
    const dest = { host: "git.example.test", repoPath: "acme/x", createdBy: owner };
    await prisma.approvedDestination.create({ data: { ...dest, projectId: a } });
    await expect(prisma.approvedDestination.create({ data: { ...dest, projectId: a } })).rejects.toThrow();
    await prisma.approvedDestination.create({ data: { ...dest, projectId: b } });
  });

  it("rejects a duplicate repo registration per device and fingerprint", async () => {
    const user = await makeUser();
    const project = await makeProject(user);
    const device = await prisma.device.create({ data: { userId: user, name: "d", os: "linux", agentVersion: "0", secretHash: "!t" } });
    const reg = { projectId: project, deviceId: device.id, repoFingerprint: "fp-1" };
    await prisma.repoRegistration.create({ data: reg });
    await expect(prisma.repoRegistration.create({ data: reg })).rejects.toThrow();
  });

  it("rejects a duplicate enrollment token hash", async () => {
    const user = await makeUser();
    const t = { userId: user, tokenHash: "hash-1", expiresAt: new Date(Date.now() + 60_000), createdBy: user };
    await prisma.enrollmentToken.create({ data: t });
    await expect(prisma.enrollmentToken.create({ data: t })).rejects.toThrow();
  });

  it("refuses to delete a project owner (Restrict)", async () => {
    const owner = await makeUser();
    await makeProject(owner);
    await expect(prisma.user.delete({ where: { id: owner } })).rejects.toThrow();
  });
});

describe("append-only and immutable history", () => {
  async function policyVersion(): Promise<{ id: string; projectId: string }> {
    const owner = await makeUser();
    const projectId = await makeProject(owner);
    const { id: policyId } = await prisma.policy.create({ data: { projectId } });
    return prisma.policyVersion.create({
      data: { policyId, projectId, version: 1, mode: "enforce", prohibitedGlobs: [], secretRules: [], createdBy: owner },
      select: { id: true, projectId: true },
    });
  }

  it("rejects UPDATE and DELETE on PolicyVersion", async () => {
    const pv = await policyVersion();
    // Prisma maps the trigger's restrict_violation to a generic error, so check the outcome and the raw message.
    await expect(prisma.policyVersion.update({ where: { id: pv.id }, data: { mode: "audit_only" } })).rejects.toThrow();
    await expect(prisma.policyVersion.delete({ where: { id: pv.id } })).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE "PolicyVersion" SET "mode" = 'audit_only'`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "PolicyVersion"`)).rejects.toThrow(/append-only/);
    expect((await prisma.policyVersion.findUniqueOrThrow({ where: { id: pv.id } })).mode).toBe("enforce");
  });

  it("rejects TRUNCATE on PolicyVersion", async () => {
    await policyVersion();
    await expect(prisma.$executeRawUnsafe('TRUNCATE "PolicyVersion" CASCADE')).rejects.toThrow(/append-only/);
  });

  it("rejects a duplicate (project, version) so versions stay monotonic per project", async () => {
    const pv = await policyVersion();
    const policy = await prisma.policy.findUniqueOrThrow({ where: { projectId: pv.projectId } });
    await expect(
      prisma.policyVersion.create({
        data: { policyId: policy.id, projectId: pv.projectId, version: 1, mode: "enforce", prohibitedGlobs: [], secretRules: [], createdBy: policy.projectId },
      }),
    ).rejects.toThrow();
  });

  it("allows inserting AdminAuditEvent but rejects UPDATE, DELETE and TRUNCATE", async () => {
    const row = await prisma.adminAuditEvent.create({
      data: { actorId: "00000000-0000-4000-8000-000000000001", action: "policy.update", targetType: "project", targetId: "p", summary: { changed: ["mode"] } },
    });
    await expect(prisma.adminAuditEvent.update({ where: { id: row.id }, data: { action: "x" } })).rejects.toThrow();
    await expect(prisma.adminAuditEvent.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE "AdminAuditEvent" SET "action" = 'x'`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "AdminAuditEvent"`)).rejects.toThrow(/append-only/);
    expect((await prisma.adminAuditEvent.findUniqueOrThrow({ where: { id: row.id } })).action).toBe("policy.update");
    await expect(prisma.$executeRawUnsafe('TRUNCATE "AdminAuditEvent"')).rejects.toThrow(/append-only/);
    expect(await prisma.adminAuditEvent.count()).toBe(1);
  });
});

describe("data minimisation", () => {
  it("has no column that could hold plaintext credentials, file contents or secret values", async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`;
    const risky = rows.filter(({ column_name }) => /(password|secret|token|content|diff|body|payload|value)/i.test(column_name));
    // Only hashes of credentials may match, plus secretRules (rule identifiers/config, never secret values).
    expect(risky.map((r) => `${r.table_name}.${r.column_name}`).sort()).toEqual([
      "Device.secretHash",
      "EnrollmentToken.tokenHash",
      "PolicyVersion.secretRules",
      "User.passwordHash",
    ]);
  });

  it("SecurityEvent has the required indexes", async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE tablename = 'SecurityEvent'`;
    const defs = rows.map((r) => r.indexdef).join("\n");
    expect(defs).toMatch(/\("projectId", "occurredAt"\)/);
    expect(defs).toMatch(/\("deviceId", "occurredAt"\)/);
    expect(defs).toMatch(/\(outcome\)/);
    expect(defs).toMatch(/\("correlationId"\)/);
  });
});
