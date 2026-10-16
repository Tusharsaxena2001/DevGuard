import { describe, expect, it } from "vitest";
import type { StatusReport } from "../use-cases/get-status.js";
import { formatStatusJson, formatStatusText } from "./status.js";

const base: StatusReport = {
  location: "/state",
  enrolled: true,
  healthy: true,
  serverUrl: "https://devguard.example.com",
  deviceId: "dev-1",
  config: "ok",
  credentials: "ok",
  repos: "ok",
  policyCache: "ok",
  registeredRepoCount: 2,
  policies: [{ projectId: "proj-a", state: "ok", fetchedAt: "2026-06-01T12:00:00.000Z" }],
};

describe("formatStatusText", () => {
  it("renders a healthy enrolled device", () => {
    expect(formatStatusText(base)).toEqual([
      "DevGuard state: /state",
      "Device: enrolled",
      "Server: https://devguard.example.com",
      "Device id: dev-1",
      "Config: ok",
      "Credentials: ok",
      "Registered repos: 2",
      "Cached policies:",
      "  proj-a: supplied locally, fetched 2026-06-01T12:00:00.000Z",
    ]);
  });

  it("renders each problem state with an actionable hint and a closing problem line", () => {
    const text = formatStatusText({
      ...base,
      healthy: false,
      enrolled: false,
      config: "invalid",
      credentials: "insecure_permissions",
      repos: "unreadable",
      policyCache: "unreadable",
      policies: [{ projectId: "proj-b", state: "invalid" }],
    }).join("\n");
    expect(text).toMatch(/Config: INVALID/);
    expect(text).toMatch(/Credentials: REFUSED .*chmod 600/);
    expect(text).toMatch(/Registered repos: UNREADABLE/);
    expect(text).toMatch(/Cached policies: UNREADABLE/);
    expect(text).toContain("Problem found");
  });

  it("says 'none' for an empty cache and shows an invalid policy entry", () => {
    expect(formatStatusText({ ...base, policies: [] })).toContain("Cached policies: none");
    expect(formatStatusText({ ...base, healthy: false, policies: [{ projectId: "p", state: "invalid" }] }).join("\n")).toMatch(/p: INVALID/);
  });

  it("omits server and device lines for a fresh device", () => {
    const fresh: StatusReport = {
      location: "/state",
      enrolled: false,
      healthy: true,
      config: "missing",
      credentials: "missing",
      repos: "missing",
      policyCache: "ok",
      registeredRepoCount: 0,
      policies: [],
    };
    const text = formatStatusText(fresh).join("\n");
    expect(text).toContain("Device: not enrolled");
    expect(text).not.toContain("Server:");
    expect(text).toContain("Config: not set up");
  });
});

describe("formatStatusJson", () => {
  it("is the report as JSON", () => {
    expect(JSON.parse(formatStatusJson(base))).toEqual(base);
  });
});
