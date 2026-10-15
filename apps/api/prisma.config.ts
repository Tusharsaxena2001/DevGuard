import { defineConfig } from "prisma/config";

// Read directly: the CLI must work before the Nest app (and its Zod env schema) exists.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env["DATABASE_URL"] ?? "" },
});
