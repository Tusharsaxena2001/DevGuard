import { describe, expect, it } from "vitest";
import { ok } from "../result.js";
import { cachedPolicy, fakeApi, fakeGit, fakeStore, syntheticSecret } from "../../test/support/fakes.js";
import { reportNewFingerprints } from "./report-fingerprints.js";
import type { RepoMatch } from "./resolve-repo.js";

const known = "a".repeat(40);
const learned = "b".repeat(40);
const store = fakeStore({ config: ok({ serverUrl: "https://devguard.example.test", deviceId: "dev-1" }), credentials: ok({ deviceId: "dev-1", deviceSecret: syntheticSecret() }) });
const match = (via: RepoMatch["via"], source: RepoMatch["source"] = "server"): RepoMatch => {
  const policy = cachedPolicy("proj-1");
  policy.project.fingerprints = [known] as never;
  return { project: policy.project, fetchedAt: policy.fetchedAt, via, source };
};
const URL_ = "git@github.com:acme/portal.git";

describe("reportNewFingerprints", () => {
  it("reports root commits the project does not know yet, with the remote as evidence", async () => {
    const api = fakeApi({ reportFingerprint: ok(undefined) });
    const sent = await reportNewFingerprints({ store, git: fakeGit({ roots: [known, learned] }), api }, [match("remote")], URL_, "/repo");
    expect(sent).toBe(1);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.args[1]).toEqual({ projectId: "proj-1", fingerprint: learned, remote: "https://github.com/acme/portal" });
  });

  it("does nothing when every root commit is already known", async () => {
    const api = fakeApi({ reportFingerprint: ok(undefined) });
    expect(await reportNewFingerprints({ store, git: fakeGit({ roots: [known] }), api }, [match("remote")], URL_, "/repo")).toBe(0);
    expect(api.calls).toEqual([]);
  });

  it.each([
    ["recognised by fingerprint already", match("fingerprint")],
    ["recognised only by manual registration", match("manual")],
    ["from a locally supplied policy", match("remote", "local")],
  ])("does not report for a project %s", async (_name, m) => {
    const api = fakeApi({ reportFingerprint: ok(undefined) });
    expect(await reportNewFingerprints({ store, git: fakeGit({ roots: [learned] }), api }, [m], URL_, "/repo")).toBe(0);
    expect(api.calls).toEqual([]);
  });

  it("does not report when the device is not enrolled", async () => {
    const api = fakeApi({ reportFingerprint: ok(undefined) });
    expect(await reportNewFingerprints({ store: fakeStore(), git: fakeGit({ roots: [learned] }), api }, [match("remote")], URL_, "/repo")).toBe(0);
    expect(api.calls).toEqual([]);
  });

  it("reports at most one new root per project per push", async () => {
    const roots = ["1", "2", "3", "4", "5"].map((c) => c.repeat(40));
    const api = fakeApi({ reportFingerprint: ok(undefined) });
    expect(await reportNewFingerprints({ store, git: fakeGit({ roots }), api }, [match("remote")], URL_, "/repo")).toBe(1);
  });

  it("never sends credentials that sit in the remote URL (a token used as the username)", async () => {
    const token = ["gh", "p_", "Z".repeat(36)].join("");
    const api = fakeApi({ reportFingerprint: ok(undefined) });
    await reportNewFingerprints({ store, git: fakeGit({ roots: [learned] }), api }, [match("remote")], `https://${token}@github.com/acme/portal.git`, "/repo");
    expect(JSON.stringify(api.calls)).not.toContain(token);
    expect(api.calls[0]?.args[1]).toMatchObject({ remote: "https://github.com/acme/portal" });
  });

  it("sends nothing when the remote URL cannot be normalised", async () => {
    const api = fakeApi({ reportFingerprint: ok(undefined) });
    expect(await reportNewFingerprints({ store, git: fakeGit({ roots: [learned] }), api }, [match("remote")], "not a url", "/repo")).toBe(0);
    expect(api.calls).toEqual([]);
  });

  it("counts only the reports the server accepted", async () => {
    const api = fakeApi();
    expect(await reportNewFingerprints({ store, git: fakeGit({ roots: [learned] }), api }, [match("remote")], URL_, "/repo")).toBe(0);
  });
});
