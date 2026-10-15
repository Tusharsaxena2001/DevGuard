import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsConfigStore } from "../src/adapters/fs-store/fs-config-store.js";
import { runCli } from "../src/cli/run.js";
import { cliDeps, recordingLogger, syntheticSecret } from "./support/fakes.js";

describe("status against a real state directory", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "devguard-cli-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")("round-trips config, detects wrong credential permissions and recovers once fixed", async () => {
    const store = createFsConfigStore(join(root, "home"));
    await store.writeConfig({ serverUrl: "https://devguard.example.com", deviceId: "dev-1" });
    await store.writeCredentials({ deviceId: "dev-1", deviceSecret: syntheticSecret() });

    const healthy = recordingLogger();
    expect(await runCli(["status"], cliDeps({ store, logger: healthy }))).toBe(0);
    expect(healthy.out.join("\n")).toContain("Device: enrolled");

    await chmod(join(root, "home", "credentials.json"), 0o644);
    const broken = recordingLogger();
    expect(await runCli(["status"], cliDeps({ store, logger: broken }))).toBe(2);
    expect(broken.out.join("\n")).toContain("REFUSED");
    expect(broken.out.join("\n")).not.toContain(syntheticSecret());
  });

  it("a corrupt credentials file that contains the secret is reported without echoing its content", async () => {
    const home = join(root, "home");
    await mkdir(home, { mode: 0o700 });
    await writeFile(join(home, "credentials.json"), `{"deviceSecret":"${syntheticSecret()}", broken`, { mode: 0o600 });
    const logger = recordingLogger();
    expect(await runCli(["status"], cliDeps({ store: createFsConfigStore(home), logger }))).toBe(2);
    expect(logger.out.join("\n")).toContain("INVALID");
    expect([...logger.out, ...logger.err].join("\n")).not.toContain(syntheticSecret());
  });
});
