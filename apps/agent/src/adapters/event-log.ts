import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { SecurityEventInputSchema, type SecurityEventInput } from "@devguard/shared";
import { AgentError } from "../errors.js";
import type { EventSink } from "../ports/event-sink.js";

/**
 * Local, append-only event log (`events.jsonl`, mode 0600), one validated `SecurityEventInput` per line. Until event
 * delivery exists (AG-7) this is where "what the hook decided" is recorded. The schema is strict, so file contents
 * and secret values cannot be stored.
 */
export function createEventLog(home: string): EventSink {
  const path = join(home, "events.jsonl");
  return {
    async record(event: SecurityEventInput): Promise<void> {
      const parsed = SecurityEventInputSchema.safeParse(event);
      if (!parsed.success) throw new AgentError("store_write_failed", "Refusing to record an invalid event.");
      try {
        await mkdir(home, { recursive: true, mode: 0o700 });
        const handle = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(parsed.data)}\n`, "utf8");
        } finally {
          await handle.close();
        }
      } catch (error) {
        throw new AgentError("store_write_failed", "Could not record the event in the local log.", { cause: error });
      }
    },
  };
}
