import type { PrismaClient } from "../../src/prisma/generated/client.js";

/**
 * Non-loginable placeholders. API-1 has no password hashing yet (argon2id arrives with API-2), and seed data must
 * never carry a usable credential. API-2's seed step sets real hashes from env.
 */
export const SEED_PASSWORD_PLACEHOLDER = "!seed-no-login";
export const SEED_DEVICE_SECRET_PLACEHOLDER = "!seed-no-device-secret";

const EVENT_IDS = [
  "00000000-0000-4000-8000-0000000000e1",
  "00000000-0000-4000-8000-0000000000e2",
  "00000000-0000-4000-8000-0000000000e3",
] as const;

export interface SeedSummary {
  readonly users: number;
  readonly projects: number;
  readonly destinations: number;
  readonly events: number;
}

/** Idempotent: every row is keyed by a natural key or fixed id, so running it twice changes nothing. */
export async function seedDatabase(prisma: PrismaClient, now: Date): Promise<SeedSummary> {
  const user = async (email: string, name: string): Promise<{ id: string }> =>
    prisma.user.upsert({
      where: { email },
      create: { email, name, passwordHash: SEED_PASSWORD_PLACEHOLDER },
      update: {},
      select: { id: true },
    });

  const admin = await user("admin@example.test", "Seed Security Admin");
  const lead = await user("lead@example.test", "Seed Team Lead");
  const alice = await user("alice@example.test", "Seed Employee Alice");
  const bob = await user("bob@example.test", "Seed Employee Bob");

  const membership = async (userId: string, role: "security_admin" | "team_lead" | "employee", projectId: string | null): Promise<void> => {
    const existing = await prisma.membership.findFirst({ where: { userId, role, projectId } });
    if (!existing) await prisma.membership.create({ data: { userId, role, projectId } });
  };

  const project = async (name: string, classification: "internal" | "confidential" | "client_owned"): Promise<{ id: string }> =>
    prisma.project.upsert({
      where: { name },
      create: { name, classification, ownerId: lead.id },
      update: {},
      select: { id: true },
    });

  const payments = await project("payments-service", "confidential");
  const website = await project("marketing-website", "internal");

  await membership(admin.id, "security_admin", null);
  await membership(lead.id, "team_lead", payments.id);
  await membership(lead.id, "team_lead", website.id);
  await membership(alice.id, "employee", payments.id);
  await membership(bob.id, "employee", website.id);

  const destination = async (projectId: string, host: string, repoPath: string): Promise<void> => {
    await prisma.approvedDestination.upsert({
      where: { projectId_host_repoPath: { projectId, host, repoPath } },
      create: { projectId, host, repoPath, createdBy: admin.id },
      update: {},
    });
  };
  await destination(payments.id, "git.example.test", "acme/payments-service");
  await destination(website.id, "git.example.test", "acme/marketing-website");

  const policy = async (projectId: string, mode: "enforce" | "audit_only"): Promise<void> => {
    const { id: policyId } = await prisma.policy.upsert({ where: { projectId }, create: { projectId }, update: {}, select: { id: true } });
    // Versions are immutable (DB trigger), so only create when missing; never upsert-update.
    const existing = await prisma.policyVersion.findUnique({ where: { projectId_version: { projectId, version: 1 } } });
    if (!existing) {
      await prisma.policyVersion.create({
        data: { policyId, projectId, version: 1, mode, prohibitedGlobs: [".env", "*.pem", "*.key"], secretRules: [], createdBy: admin.id },
      });
    }
  };
  await policy(payments.id, "enforce");
  await policy(website.id, "audit_only");

  let device = await prisma.device.findFirst({ where: { userId: alice.id, name: "seed-laptop-alice" } });
  device ??= await prisma.device.create({
    data: { userId: alice.id, name: "seed-laptop-alice", os: "linux", agentVersion: "0.0.0", secretHash: SEED_DEVICE_SECRET_PLACEHOLDER },
  });

  const [e1, e2, e3] = EVENT_IDS;
  const at = (minutesAgo: number): Date => new Date(now.getTime() - minutesAgo * 60_000);
  const base = { deviceId: device.id, userId: alice.id, projectId: payments.id, operation: "push" as const, destRepo: "acme/payments-service" };
  await prisma.securityEvent.createMany({
    skipDuplicates: true,
    data: [
      { ...base, id: e1, occurredAt: at(180), destHost: "git.example.test", ruleIds: ["allowed"], mode: "enforce", outcome: "allowed", correlationId: "seed-corr-1", policyVersion: 1 },
      { ...base, id: e2, occurredAt: at(120), destHost: "other.example.test", ruleIds: ["destination_not_approved"], mode: "enforce", outcome: "blocked", correlationId: "seed-corr-2", policyVersion: 1 },
      { ...base, id: e3, occurredAt: at(60), destHost: "git.example.test", ruleIds: ["prohibited_file"], mode: "enforce", outcome: "blocked", correlationId: "seed-corr-3", policyVersion: 1 },
    ],
  });

  return {
    users: await prisma.user.count(),
    projects: await prisma.project.count(),
    destinations: await prisma.approvedDestination.count(),
    events: await prisma.securityEvent.count(),
  };
}
