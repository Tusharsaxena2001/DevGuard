import { describe, expect, it, vi } from "vitest";
import type { SecurityEventInput } from "@devguard/shared";
import type { Env } from "../../config/env.js";
import { AlertsService } from "./alerts.service.js";
import type { MailSender } from "./mail-sender.js";

const blocked = {
  outcome: "blocked",
  mode: "enforce",
  ruleIds: ["destination_not_approved"],
  projectId: null,
  destination: { host: "github.com", repoPath: "personal/fork" },
  operation: "push",
  occurredAt: "2026-06-01T12:00:00.000Z",
} as unknown as SecurityEventInput;
const device = { kind: "device", deviceId: "d1", userId: "u1" } as const;

function build(send: MailSender["send"]): AlertsService {
  const mail: MailSender = { send };
  const users = { adminEmails: () => Promise.resolve(["a@example.test"]), namesById: () => Promise.resolve(new Map([["u1", "alice"]])) };
  const projects = { findMany: () => Promise.resolve([]) };
  const devices = { nameById: () => Promise.resolve("laptop") };
  const env = { SMTP_HOST: "localhost", DASHBOARD_BASE_URL: "http://localhost:5173" } as Env;
  return new AlertsService(mail, users as never, projects as never, devices as never, env);
}

describe("AlertsService overload cap", () => {
  it("drops alerts beyond 50 waiting ones instead of queueing without limit", async () => {
    const release: (() => void)[] = [];
    const send = vi.fn(() => new Promise<void>((resolve) => release.push(resolve)));
    const service = build(send);
    for (let i = 0; i < 51; i += 1) service.onEventsRecorded(device, [blocked]);
    // Let the 50 accepted alerts reach the (never-resolving) send.
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(50));
    expect(send).toHaveBeenCalledTimes(50);
    release.forEach((r) => r());
    await service.idle();
  });
});
