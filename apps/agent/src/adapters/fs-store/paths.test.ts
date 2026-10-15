import { describe, expect, it } from "vitest";
import { resolveDevGuardHome } from "./paths.js";

describe("resolveDevGuardHome", () => {
  it("defaults to ~/.config/devguard", () => {
    expect(resolveDevGuardHome({}, "/home/dev")).toEqual({ ok: true, value: "/home/dev/.config/devguard" });
  });

  it("treats an empty override as unset", () => {
    expect(resolveDevGuardHome({ DEVGUARD_HOME: "" }, "/home/dev")).toEqual({ ok: true, value: "/home/dev/.config/devguard" });
  });

  it("uses an absolute DEVGUARD_HOME", () => {
    expect(resolveDevGuardHome({ DEVGUARD_HOME: "/tmp/x" }, "/home/dev")).toEqual({ ok: true, value: "/tmp/x" });
  });

  it.each(["relative/dir", "./here", "..", "x"])("rejects relative DEVGUARD_HOME %j", (value) => {
    expect(resolveDevGuardHome({ DEVGUARD_HOME: value }, "/home/dev")).toEqual({ ok: false, reason: "relative_home" });
  });
});
