import { describe, expect, it } from "vitest";
import { fail, ok } from "../result.js";
import { fakeApi, fakeStore, syntheticSecret } from "../../test/support/fakes.js";
import type { ConfigStore } from "../ports/config-store.js";
import { checkException } from "./check-exception.js";

const store = fakeStore({ config: ok({ serverUrl: "https://devguard.example.test", deviceId: "dev-1" }), credentials: ok({ deviceId: "dev-1", deviceSecret: syntheticSecret() }) });
const valid = { valid: true, exceptionId: "exc-1", expiresAt: "2026-06-02T12:00:00.000Z", approverId: "admin-1", requesterId: "user-1", waivedRuleIds: [] };

describe("checkException", () => {
  it("turns a valid server answer into the exception the policy engine expects, scoped to the normalised destination", async () => {
    const api = fakeApi({ validateException: ok(valid) });
    const result = await checkException({ store, api }, "proj-1", "git@GitHub.com:Customer/Portal-Copy.git");
    expect(result).toEqual({
      state: "valid",
      exception: { id: "exc-1", projectId: "proj-1", destination: { host: "github.com", repoPath: "customer/portal-copy" }, status: "approved", expiresAt: valid.expiresAt, approverId: "admin-1", requesterId: "user-1", waivedRuleIds: [] },
    });
  });

  it("ignores any waived rule ids the server sends: an exception never waives secrets or prohibited files", async () => {
    const api = fakeApi({ validateException: ok({ ...valid, waivedRuleIds: ["secret_detected", "prohibited_file"] }) });
    const result = await checkException({ store, api }, "proj-1", "git@github.com:customer/portal-copy.git");
    expect(result).toMatchObject({ state: "valid", exception: { waivedRuleIds: [] } });
  });

  it("sends the project and the canonical https destination, never the raw URL (it may carry a token)", async () => {
    const token = ["gh", "p_", "Z".repeat(36)].join("");
    const api = fakeApi({ validateException: ok({ valid: false }) });
    await checkException({ store, api }, "proj-1", `https://${token}@github.com/acme/portal.git`);
    expect(api.calls[0]?.args[1]).toEqual({ projectId: "proj-1", destination: "https://github.com/acme/portal" });
    expect(JSON.stringify(api.calls)).not.toContain(token);
  });

  it("is none when the server says it is not valid, or leaves out what is needed to build an exception", async () => {
    expect(await checkException({ store, api: fakeApi({ validateException: ok({ valid: false }) }) }, "p", "git@github.com:a/b.git")).toEqual({ state: "none" });
    for (const missing of ["exceptionId", "expiresAt", "approverId", "requesterId"] as const) {
      const partial = { ...valid, [missing]: undefined };
      expect(await checkException({ store, api: fakeApi({ validateException: ok(partial as typeof valid) }) }, "p", "git@github.com:a/b.git")).toEqual({ state: "none" });
    }
  });

  it.each(["unreachable", "server_error", "unauthorized", "revoked", "rate_limited"] as const)("is unavailable when the server cannot answer (%s): no exception can be used", async (reason) => {
    expect(await checkException({ store, api: fakeApi({ validateException: fail(reason) }) }, "p", "git@github.com:a/b.git")).toEqual({ state: "unavailable" });
  });

  it("does not ask for a destination that does not parse, or when not enrolled", async () => {
    const api = fakeApi({ validateException: ok(valid) });
    expect(await checkException({ store, api }, "p", "not a url")).toEqual({ state: "none" });
    expect(await checkException({ store: fakeStore(), api }, "p", "git@github.com:a/b.git")).toEqual({ state: "none" });
    const broken: ConfigStore = { ...fakeStore(), readConfig: async () => fail("invalid"), readCredentials: async () => ok({ deviceId: "d", deviceSecret: "s" }) };
    expect(await checkException({ store: broken, api }, "p", "git@github.com:a/b.git")).toEqual({ state: "none" });
    expect(api.calls).toEqual([]);
  });
});
