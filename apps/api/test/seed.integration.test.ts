import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SEED_DEVICE_SECRET_PLACEHOLDER, SEED_PASSWORD_PLACEHOLDER, seedDatabase } from "../prisma/seed/seed.js";
import { createTestPrisma, resetData } from "./support.js";

const prisma = createTestPrisma();
const now = new Date("2026-01-01T00:00:00Z");
afterAll(() => prisma.$disconnect());
beforeEach(() => resetData(prisma));

async function counts(): Promise<Record<string, number>> {
  return {
    users: await prisma.user.count(),
    memberships: await prisma.membership.count(),
    projects: await prisma.project.count(),
    destinations: await prisma.approvedDestination.count(),
    policies: await prisma.policy.count(),
    policyVersions: await prisma.policyVersion.count(),
    devices: await prisma.device.count(),
    events: await prisma.securityEvent.count(),
  };
}

describe("seed", () => {
  it("creates the synthetic dataset on a clean database", async () => {
    const summary = await seedDatabase(prisma, now);
    expect(summary).toEqual({ users: 5, projects: 2, destinations: 2, events: 3 });
    const roles = (await prisma.membership.findMany()).map((m) => m.role).sort();
    expect(roles).toEqual(["employee", "employee", "security_admin", "security_admin", "team_lead", "team_lead"]);
  });

  it("is safe to run twice: row counts do not change", async () => {
    await seedDatabase(prisma, now);
    const first = await counts();
    await seedDatabase(prisma, new Date("2026-02-02T00:00:00Z"));
    expect(await counts()).toEqual(first);
  });

  it("is safe to resume after partial manual changes (does not overwrite existing users)", async () => {
    await seedDatabase(prisma, now);
    await prisma.user.update({ where: { email: "admin@example.test" }, data: { passwordHash: "set-by-api-2" } });
    await seedDatabase(prisma, now);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.test" } })).passwordHash).toBe("set-by-api-2");
  });

  it("ships no usable credentials: only non-loginable placeholders", async () => {
    await seedDatabase(prisma, now);
    const hashes = (await prisma.user.findMany()).map((u) => u.passwordHash);
    expect(new Set(hashes)).toEqual(new Set([SEED_PASSWORD_PLACEHOLDER]));
    expect(SEED_PASSWORD_PLACEHOLDER.startsWith("!")).toBe(true);
    expect((await prisma.device.findMany()).every((d) => d.secretHash === SEED_DEVICE_SECRET_PLACEHOLDER)).toBe(true);
  });

  it("seeds events with metadata only (rule ids, destination, decision)", async () => {
    await seedDatabase(prisma, now);
    const events = await prisma.securityEvent.findMany();
    expect(events.map((e) => e.outcome).sort()).toEqual(["allowed", "blocked", "blocked"]);
    expect(events.every((e) => e.ruleIds.length > 0)).toBe(true);
  });
});

describe("seed with a password hash", () => {
  it("sets it only on users that still hold the placeholder", async () => {
    await seedDatabase(prisma, now);
    await prisma.user.update({ where: { email: "alice@example.test" }, data: { passwordHash: "already-real" } });
    await seedDatabase(prisma, now, "hash-from-env");
    const byEmail = Object.fromEntries((await prisma.user.findMany()).map((u) => [u.email, u.passwordHash]));
    expect(byEmail["alice@example.test"]).toBe("already-real");
    expect(byEmail["admin@example.test"]).toBe("hash-from-env");
    expect(byEmail["admin2@example.test"]).toBe("hash-from-env");
  });
});
