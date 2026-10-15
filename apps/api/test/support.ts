import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/prisma/generated/client.js";
import type { Env } from "../src/config/env.js";

export function testEnv(overrides: Partial<Record<keyof Env, string>> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: process.env["DATABASE_URL"],
    // Built at runtime so no secret-looking literal lives in the repo.
    JWT_SECRET: "j".repeat(40),
    DASHBOARD_BASE_URL: "http://localhost:5173",
    ...overrides,
  };
}

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env["DATABASE_URL"] }) });
}

const PROTECTED_TRIGGERS: readonly (readonly [table: string, trigger: string])[] = [
  ["AdminAuditEvent", "AdminAuditEvent_append_only"],
  ["AdminAuditEvent", "AdminAuditEvent_no_truncate"],
  ["PolicyVersion", "PolicyVersion_immutable"],
  ["PolicyVersion", "PolicyVersion_no_truncate"],
];

/**
 * Test-only: clears every table. The append-only triggers are switched off for the duration (the table owner may do
 * this; the application role never does) and switched back on before returning.
 */
export async function resetData(prisma: PrismaClient): Promise<void> {
  const toggle = (verb: "DISABLE" | "ENABLE"): string[] =>
    PROTECTED_TRIGGERS.map(([table, trigger]) => `ALTER TABLE "${table}" ${verb} TRIGGER "${trigger}"`);
  await prisma.$transaction([
    ...toggle("DISABLE").map((sql) => prisma.$executeRawUnsafe(sql)),
    prisma.$executeRawUnsafe(`
      TRUNCATE "SecurityEvent", "ExceptionDecision", "ExceptionRequest", "RepoRegistration", "ApprovedDestination",
               "EnrollmentToken", "Device", "Membership", "Project", "Policy", "User", "PolicyVersion", "AdminAuditEvent"
      RESTART IDENTITY CASCADE`),
    ...toggle("ENABLE").map((sql) => prisma.$executeRawUnsafe(sql)),
  ]);
}
