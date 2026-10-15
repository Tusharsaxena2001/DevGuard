import "reflect-metadata";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { parseEnv, type Env } from "../src/config/env.js";
import { testEnv } from "./support.js";

function envFor(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  const result = parseEnv(testEnv(overrides));
  if (!result.ok) throw new Error(`bad test env: ${result.problems.join(", ")}`);
  return result.env;
}

async function start(overrides: Partial<Record<keyof Env, string>> = {}): Promise<NestExpressApplication> {
  const app = await createApp(envFor(overrides));
  await app.init();
  return app;
}

describe("health, docs, headers and CORS", () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await start();
  });
  afterAll(async () => {
    await app.close();
  });

  it("GET /health is public and reports ok with the database up", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("serves the OpenAPI document and UI outside production", async () => {
    const json = await request(app.getHttpServer()).get("/docs-json");
    expect(json.status).toBe(200);
    expect(json.body.openapi).toMatch(/^3\./);
    expect(Object.keys(json.body.paths)).toContain("/health");
    const ui = await request(app.getHttpServer()).get("/docs");
    expect(ui.status).toBe(200);
  });

  it("sets helmet security headers and hides x-powered-by", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("allows CORS preflight only from the dashboard origin", async () => {
    const ok = await request(app.getHttpServer()).options("/health").set("Origin", "http://localhost:5173").set("Access-Control-Request-Method", "GET");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const bad = await request(app.getHttpServer()).options("/health").set("Origin", "http://evil.example").set("Access-Control-Request-Method", "GET");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers unknown routes with a generic not_found body", async () => {
    const res = await request(app.getHttpServer()).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: "not_found", message: "The requested resource was not found." });
  });

  it("answers malformed JSON with a clean 400 validation_failed", async () => {
    const res = await request(app.getHttpServer()).post("/health").set("Content-Type", "application/json").send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_failed");
    expect(JSON.stringify(res.body)).not.toContain("position");
  });
});

describe("production and throttling", () => {
  it("does not serve /docs in production", async () => {
    const app = await start({ NODE_ENV: "production" });
    try {
      expect((await request(app.getHttpServer()).get("/docs")).status).toBe(404);
      expect((await request(app.getHttpServer()).get("/health")).status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("returns 429 rate_limited after the configured limit", async () => {
    const app = await start({ THROTTLE_LIMIT: "3", THROTTLE_TTL_SECONDS: "60" });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await request(app.getHttpServer()).get("/health")).status);
      expect(statuses).toEqual([200, 200, 200, 429, 429]);
      const limited = await request(app.getHttpServer()).get("/health");
      expect(limited.body.code).toBe("rate_limited");
    } finally {
      await app.close();
    }
  });
});

describe("database down", () => {
  it("startup fails fast instead of running without a database", async () => {
    const dead = new URL(process.env["DATABASE_URL"] ?? "");
    dead.port = "1"; // nothing listens here
    await expect(start({ DATABASE_URL: dead.toString() })).rejects.toBeDefined();
  });
});
