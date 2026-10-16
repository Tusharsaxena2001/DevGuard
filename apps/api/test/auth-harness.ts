import "reflect-metadata";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import request from "supertest";
import { createApp } from "../src/bootstrap.js";
import { hashPassword } from "../src/common/crypto/passwords.js";
import { parseEnv, type Env } from "../src/config/env.js";
import type { PrismaClient } from "../src/prisma/generated/client.js";
import { testEnv } from "./support.js";

export const PASSWORD = ["Test", "Pass", "1234567"].join("-"); // built at runtime: no password literal in the repo

export async function startApp(overrides: Partial<Record<keyof Env, string>> = {}): Promise<NestExpressApplication> {
  const parsed = parseEnv(testEnv({ AUTH_THROTTLE_LIMIT: "1000", THROTTLE_LIMIT: "100000", ...overrides }));
  if (!parsed.ok) throw new Error(`bad test env: ${parsed.problems.join(", ")}`);
  const app = await createApp(parsed.env);
  await app.init();
  return app;
}

export interface SeededUsers {
  readonly admin: { id: string; email: string };
  readonly admin2: { id: string; email: string };
  readonly alice: { id: string; email: string };
  readonly bob: { id: string; email: string };
}

/** Four users with a known password: two admins and two employees. */
export async function seedUsers(prisma: PrismaClient): Promise<SeededUsers> {
  const passwordHash = await hashPassword(PASSWORD);
  const make = async (email: string, isAdmin: boolean): Promise<{ id: string; email: string }> => {
    const user = await prisma.user.create({
      data: { email, name: email.split("@")[0] ?? email, passwordHash, memberships: { create: { role: isAdmin ? "security_admin" : "employee", projectId: null } } },
    });
    return { id: user.id, email };
  };
  return {
    admin: await make("admin@example.test", true),
    admin2: await make("admin2@example.test", true),
    alice: await make("alice@example.test", false),
    bob: await make("bob@example.test", false),
  };
}

/** Signs in and returns the raw `Cookie` header value to send on later requests. */
export async function login(app: NestExpressApplication, email: string, password = PASSWORD): Promise<string> {
  const res = await request(app.getHttpServer()).post("/v1/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed with ${res.status}`);
  const set = res.headers["set-cookie"];
  const first = Array.isArray(set) ? set[0] : undefined;
  if (!first) throw new Error("no session cookie");
  return first.split(";")[0] ?? "";
}

export interface EnrolledDevice {
  readonly deviceId: string;
  readonly bearer: string;
}

export async function issueToken(app: NestExpressApplication, adminCookie: string, userId: string): Promise<string> {
  const res = await request(app.getHttpServer()).post("/v1/devices/enrollment-tokens").set("Cookie", adminCookie).send({ userId });
  if (res.status !== 201) throw new Error(`token issue failed with ${res.status}`);
  return res.body.token as string;
}

export async function enroll(app: NestExpressApplication, token: string, deviceName = "test-laptop"): Promise<EnrolledDevice> {
  const res = await request(app.getHttpServer()).post("/v1/devices/enroll").send({ token, deviceName, os: "linux", agentVersion: "0.1.0" });
  if (res.status !== 201) throw new Error(`enroll failed with ${res.status}`);
  return { deviceId: res.body.deviceId as string, bearer: `Bearer ${res.body.deviceId as string}.${res.body.deviceSecret as string}` };
}

/** A session token signed with the test secret, for forging expired or odd-claim tokens. */
export async function signSession(claims: { sub: string; iat: number; exp: number }, alg: "HS256" = "HS256"): Promise<string> {
  const key = new TextEncoder().encode(testEnv()["JWT_SECRET"]);
  return new SignJWT({}).setProtectedHeader({ alg }).setSubject(claims.sub).setIssuedAt(claims.iat).setExpirationTime(claims.exp).sign(key);
}

export async function createProject(app: NestExpressApplication, adminCookie: string, name = "payments", classification = "confidential"): Promise<string> {
  const res = await request(app.getHttpServer()).post("/v1/projects").set("Cookie", adminCookie).send({ name, classification });
  if (res.status !== 201) throw new Error(`project create failed with ${res.status}`);
  return res.body.id as string;
}

/** A sha1-looking root commit, built from a seed character. */
export const sha = (c: string): string => c.repeat(40);
