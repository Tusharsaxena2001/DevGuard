import { describe, expect, it } from "vitest";
import type { ApprovedDestination } from "@devguard/shared";
import { isApproved, isRawDestinationApproved } from "./match.js";

const allowlist: ApprovedDestination[] = [
  { id: "d1", host: "github.com", repoPath: "acme-corp/portal", type: "exact" },
  { id: "d2", host: "github.com", repoPath: "acme-corp", type: "owner_wildcard" },
  { id: "d3", host: "git.corp.example:8443", repoPath: "team/app", type: "exact" },
];

describe("isApproved", () => {
  it("approves an exact host + repo match", () => {
    expect(isApproved({ host: "github.com", repoPath: "acme-corp/portal" }, allowlist)).toEqual({
      approved: true,
      matchedEntryId: "d1",
    });
  });

  it("returns no matchedEntryId when the entry has none", () => {
    const result = isApproved({ host: "github.com", repoPath: "x/y" }, [
      { host: "github.com", repoPath: "x/y", type: "exact" },
    ]);
    expect(result).toEqual({ approved: true });
  });

  it("approves any repo under an owner_wildcard owner", () => {
    expect(isApproved({ host: "github.com", repoPath: "acme-corp/other" }, [allowlist[1]!])).toEqual({
      approved: true,
      matchedEntryId: "d2",
    });
  });

  it("matches the non-default port exactly", () => {
    expect(isApproved({ host: "git.corp.example:8443", repoPath: "team/app" }, allowlist).approved).toBe(true);
    expect(isApproved({ host: "git.corp.example", repoPath: "team/app" }, allowlist).approved).toBe(false);
    expect(isApproved({ host: "git.corp.example:9443", repoPath: "team/app" }, allowlist).approved).toBe(false);
  });

  it.each([
    ["different repo, same owner (exact entry only)", { host: "github.com", repoPath: "acme-corp/other" }, [0]],
    ["different owner", { host: "github.com", repoPath: "priya/portal" }, [0, 1]],
    ["owner prefix lookalike", { host: "github.com", repoPath: "acme-corp-evil/portal" }, [0, 1]],
    ["owner suffix lookalike", { host: "github.com", repoPath: "evil-acme-corp/portal" }, [0, 1]],
    ["host suffix lookalike", { host: "github.com.evil.example", repoPath: "acme-corp/portal" }, [0, 1]],
    ["host prefix lookalike", { host: "evilgithub.com", repoPath: "acme-corp/portal" }, [0, 1]],
    ["subdomain of approved host", { host: "gist.github.com", repoPath: "acme-corp/portal" }, [0, 1]],
    ["wildcard owner itself is not a repo", { host: "github.com", repoPath: "acme-corp" }, [1]],
    ["repo path extended beyond exact entry", { host: "github.com", repoPath: "acme-corp/portal/extra" }, [0]],
  ])("rejects %s", (_name, destination, indexes) => {
    const entries = indexes.map((i) => allowlist[i]!);
    expect(isApproved(destination, entries).approved).toBe(false);
  });

  it("does not use substring matching for exact entries", () => {
    expect(isApproved({ host: "github.com", repoPath: "acme-corp/portal-clone" }, [allowlist[0]!]).approved).toBe(false);
    expect(isApproved({ host: "xgithub.com", repoPath: "acme-corp/portal" }, [allowlist[0]!]).approved).toBe(false);
  });

  it("owner_wildcard matches any depth under the owner (nested groups), by whole segments", () => {
    const wildcard: ApprovedDestination[] = [{ host: "gitlab.com", repoPath: "acme-corp", type: "owner_wildcard" }];
    expect(isApproved({ host: "gitlab.com", repoPath: "acme-corp/sub/repo" }, wildcard).approved).toBe(true);
    expect(isApproved({ host: "gitlab.com", repoPath: "acme-corp2/repo" }, wildcard).approved).toBe(false);
  });

  it("the unsupported `org/*` entry spelling matches nothing (store the bare owner instead)", () => {
    const star: ApprovedDestination[] = [{ host: "github.com", repoPath: "acme-corp/*", type: "owner_wildcard" }];
    expect(isApproved({ host: "github.com", repoPath: "acme-corp/portal" }, star).approved).toBe(false);
  });

  it("an unknown entry type fails closed even when it looks like a prefix match", () => {
    const unknownType = [{ host: "github.com", repoPath: "acme-corp", type: "prefix" }] as unknown as ApprovedDestination[];
    expect(isApproved({ host: "github.com", repoPath: "acme-corp/portal" }, unknownType).approved).toBe(false);
  });

  it("an empty allowlist approves nothing", () => {
    expect(isApproved({ host: "github.com", repoPath: "acme-corp/portal" }, [])).toEqual({ approved: false });
  });

  it("ignores malformed entries instead of matching loosely", () => {
    const broken: ApprovedDestination[] = [
      { host: "", repoPath: "acme-corp/portal", type: "exact" },
      { host: "github.com", repoPath: "../..", type: "exact" },
      { host: "github.com", repoPath: "", type: "owner_wildcard" },
      { host: "*", repoPath: "*", type: "exact" },
      { host: "github.com/", repoPath: "acme-corp/portal", type: "exact" },
    ];
    expect(isApproved({ host: "github.com", repoPath: "acme-corp/portal" }, broken).approved).toBe(false);
    expect(isApproved({ host: "evil.example", repoPath: "x/y" }, broken).approved).toBe(false);
  });

  it("canonicalises sloppily stored entries (case) but never widens them", () => {
    const sloppy: ApprovedDestination[] = [{ host: "GitHub.com", repoPath: "Acme-Corp/Portal", type: "exact" }];
    expect(isApproved({ host: "github.com", repoPath: "acme-corp/portal" }, sloppy).approved).toBe(true);
    expect(isApproved({ host: "github.com", repoPath: "acme-corp/other" }, sloppy).approved).toBe(false);
  });

  it("an ssh entry on port 443 is not widened to the https default", () => {
    const entry: ApprovedDestination[] = [{ host: "github.com:443", repoPath: "acme-corp/portal", type: "exact" }];
    expect(isApproved({ host: "github.com", repoPath: "acme-corp/portal" }, entry).approved).toBe(false);
    expect(isApproved({ host: "github.com:443", repoPath: "acme-corp/portal" }, entry).approved).toBe(true);
  });

  it("case-sensitive hosts keep case, so a different-case path is a different repo", () => {
    const entry: ApprovedDestination[] = [{ host: "git.corp.example", repoPath: "Team/App", type: "exact" }];
    expect(isApproved({ host: "git.corp.example", repoPath: "Team/App" }, entry).approved).toBe(true);
    expect(isApproved({ host: "git.corp.example", repoPath: "team/app" }, entry).approved).toBe(false);
  });
});

describe("isRawDestinationApproved", () => {
  const list: ApprovedDestination[] = [{ id: "d1", host: "github.com", repoPath: "acme-corp/portal", type: "exact" }];

  it.each([
    "https://github.com/acme-corp/portal.git",
    "git@github.com:acme-corp/portal.git",
    "ssh://git@github.com/acme-corp/portal",
  ])("approves %s", (raw) => {
    expect(isRawDestinationApproved(raw, list).approved).toBe(true);
  });

  it.each([
    "https://github.com/priya-personal/portal.git",
    "https://github.com.evil.example/acme-corp/portal.git",
    "https://github.com@evil.example/acme-corp/portal.git",
    "git@github.com@evil.example:acme-corp/portal.git",
    "https://gіthub.com/acme-corp/portal.git",
    "http://github.com/acme-corp/portal.git",
    "/srv/git/portal.git",
    "",
    undefined,
    "not a url",
  ])("never approves %p", (raw) => {
    expect(isRawDestinationApproved(raw, list).approved).toBe(false);
  });
});
