import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import pg from "pg";

const TEST_DB = "devguard_test";

/** DATABASE_URL from the environment, else from the repo-root .env (gitignored). Only localhost is accepted. */
function baseUrl(): URL {
  let raw = process.env["DATABASE_URL"];
  const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
  if (!raw && existsSync(envFile)) {
    raw = /^DATABASE_URL=(.+)$/m.exec(readFileSync(envFile, "utf8"))?.[1]?.trim();
  }
  if (!raw) throw new Error("DATABASE_URL is not set (copy .env.example to .env and run `pnpm db:up`).");
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("Refusing to run API tests against a non-local database.");
  }
  return url;
}

/** Creates a fresh dedicated test database and applies the real migrations. Tests never touch the dev database. */
export default async function setup(): Promise<() => Promise<void>> {
  const admin = baseUrl();
  const testUrl = new URL(admin.toString());
  testUrl.pathname = `/${TEST_DB}`;

  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await client.end();
  }

  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
  });

  process.env["DATABASE_URL"] = testUrl.toString();
  return async () => {
    const c = new pg.Client({ connectionString: admin.toString() });
    await c.connect();
    try {
      await c.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    } finally {
      await c.end();
    }
  };
}
