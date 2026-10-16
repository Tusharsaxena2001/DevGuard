import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/common/crypto/passwords.js";
import { PrismaClient } from "../src/prisma/generated/client.js";
import { seedDatabase } from "./seed/seed.js";

if (process.env["NODE_ENV"] === "production") {
  process.stderr.write("Refusing to seed with NODE_ENV=production: the seed creates well-known admin accounts.\n");
  process.exit(1);
}

const url = process.env["DATABASE_URL"];
if (!url) {
  process.stderr.write("DATABASE_URL is not set.\n");
  process.exit(1);
}

// Dev password for every seed user: SEED_PASSWORD, else random and printed once. Never committed, never reused in production.
const fromEnv = process.env["SEED_PASSWORD"] || undefined; // empty counts as unset
if (fromEnv !== undefined && fromEnv.length < 12) {
  process.stderr.write("SEED_PASSWORD must be at least 12 characters.\n");
  process.exit(1);
}
const password = fromEnv ?? randomBytes(12).toString("base64url");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
try {
  const summary = await seedDatabase(prisma, new Date(), await hashPassword(password));
  process.stdout.write(`Seed complete (synthetic data): ${JSON.stringify(summary)}\n`);
  if (fromEnv === undefined) {
    process.stdout.write(`Seed users (admin@example.test, admin2@example.test, alice@example.test, ...) can sign in with: ${password}\n`);
    process.stdout.write("(Shown once. Users that already had a real password keep it. Set SEED_PASSWORD to choose your own.)\n");
  }
} finally {
  await prisma.$disconnect();
}
