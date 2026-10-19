import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { startApp } from "./auth-harness.js";

let app: NestExpressApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Three bad logins from one claimed client address, then one from another; returns the status of each. */
async function attempts(hops: string): Promise<number[]> {
  const started = await startApp({ AUTH_THROTTLE_LIMIT: "2", TRUST_PROXY_HOPS: hops });
  app = started;
  const login = (forwardedFor: string) =>
    request(started.getHttpServer()).post("/v1/auth/login").set("X-Forwarded-For", forwardedFor).send({ email: "nobody@example.test", password: "wrong-password-123" });
  const statuses: number[] = [];
  for (const ip of ["198.51.100.1", "198.51.100.1", "198.51.100.1", "198.51.100.2"]) statuses.push((await login(ip)).status);
  return statuses;
}

describe("rate limiting behind a reverse proxy (TRUST_PROXY_HOPS)", () => {
  it("with one trusted proxy, each client address has its own login bucket", async () => {
    expect(await attempts("1")).toEqual([401, 401, 429, 401]);
  });

  it("with no trusted proxy, X-Forwarded-For is ignored: a spoofed address cannot dodge the limit", async () => {
    expect(await attempts("0")).toEqual([401, 401, 429, 429]);
  });
});
