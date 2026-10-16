import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** A stand-in for the DevGuard API, in its own process (see stub-api.mjs). */
export class StubApi {
  private child!: ChildProcess;
  private readonly dir = mkdtempSync(join(tmpdir(), "devguard-stub-"));
  port = 0;

  async start(): Promise<void> {
    this.child = spawn(process.execPath, [fileURLToPath(new URL("./stub-api.mjs", import.meta.url)), this.dir], { stdio: ["ignore", "pipe", "inherit"] });
    this.port = await new Promise<number>((resolve, reject) => {
      this.child.stdout?.once("data", (chunk: Buffer) => resolve(Number(chunk.toString().trim())));
      this.child.once("error", reject);
    });
  }

  async stop(): Promise<void> {
    this.child.kill();
    rmSync(this.dir, { recursive: true, force: true });
  }

  set up(value: boolean) {
    if (value) rmSync(join(this.dir, "down"), { force: true });
    else writeFileSync(join(this.dir, "down"), "");
  }

  get received(): { authorization: string | undefined; events: Record<string, unknown>[]; raw: string }[] {
    try {
      return readFileSync(join(this.dir, "received"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const entry = JSON.parse(line) as { authorization?: string; body: string };
          return { authorization: entry.authorization, events: (JSON.parse(entry.body) as { events: Record<string, unknown>[] }).events, raw: entry.body };
        });
    } catch {
      return [];
    }
  }

  /** The answer the stub gives to exception validation (default: not valid). */
  grantException(answer: Record<string, unknown>): void {
    writeFileSync(join(this.dir, "exception.json"), JSON.stringify(answer));
  }

  /** The validation requests the hook sent. */
  get validations(): Record<string, unknown>[] {
    try {
      return readFileSync(join(this.dir, "validated"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    } catch {
      return [];
    }
  }

  get delivered(): Record<string, unknown>[] {
    return this.received.flatMap((r) => r.events);
  }
}

