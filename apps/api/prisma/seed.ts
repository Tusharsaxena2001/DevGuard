import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/prisma/generated/client.js";
import { seedDatabase } from "./seed/seed.js";

const url = process.env["DATABASE_URL"];
if (!url) {
  process.stderr.write("DATABASE_URL is not set.\n");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
try {
  const summary = await seedDatabase(prisma, new Date());
  process.stdout.write(`Seed complete (synthetic data, no usable credentials): ${JSON.stringify(summary)}\n`);
} finally {
  await prisma.$disconnect();
}
