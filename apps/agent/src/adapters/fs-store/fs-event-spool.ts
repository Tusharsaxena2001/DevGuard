import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { SecurityEventInputSchema, type SecurityEventInput } from "@devguard/shared";
import { AgentError } from "../../errors.js";
import type { EventSpool, SpooledEvent, SpoolStats } from "../../ports/event-spool.js";
import { checkDirectory, readJsonFile, writeJsonFile } from "./atomic-file.js";

export const DEFAULT_MAX_SPOOLED_EVENTS = 1000;
const SAFE_KEY = /^[A-Za-z0-9_-]{8,128}$/;
const FILE = /^(\d{15})-([A-Za-z0-9_-]{8,128})\.json$/;
const DroppedSchema = z.object({ count: z.number().int().min(0) }).strict();

/** Sorts oldest first: zero-padded milliseconds of `occurredAt`, then the key. */
function fileName(event: SecurityEventInput): string {
  const at = Number.isFinite(Date.parse(event.occurredAt)) ? Math.max(0, Date.parse(event.occurredAt)) : 0;
  return `${String(at).padStart(15, "0")}-${event.idempotencyKey}.json`;
}

/**
 * Directory-backed spool (`<home>/spool/*.json`, one validated `SecurityEventInput` each, mode 0600, atomic writes).
 * The schema is strict, so file contents and secret values cannot be stored. Everything here tolerates a concurrent
 * hook: a file that vanished is skipped, never an error.
 */
export function createFsEventSpool(home: string, options: { maxEvents?: number } = {}): EventSpool {
  const dir = join(home, "spool");
  const droppedPath = join(home, "spool-dropped.json");
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_SPOOLED_EVENTS;

  async function names(): Promise<string[] | undefined> {
    const trusted = await checkDirectory(dir);
    if (!trusted.ok) return undefined;
    try {
      return (await readdir(dir)).filter((n) => FILE.test(n)).sort();
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : undefined;
    }
  }

  const unlinkQuietly = (name: string): Promise<void> => unlink(join(dir, name)).catch(() => undefined);

  async function readDropped(): Promise<number> {
    const read = await readJsonFile(droppedPath, DroppedSchema, { requirePrivate: false });
    return read.ok ? (read.value?.count ?? 0) : 0;
  }

  async function addDropped(n: number): Promise<void> {
    if (n <= 0) return;
    try {
      await writeJsonFile(droppedPath, DroppedSchema, { count: (await readDropped()) + n });
    } catch {
      // The counter is informational; losing an increment must not break delivery.
    }
  }

  /** Removes the entries with these keys; returns how many were actually there. */
  async function remove(keys: readonly string[]): Promise<number> {
    const wanted = new Set(keys);
    let removed = 0;
    for (const name of (await names()) ?? []) {
      const key = FILE.exec(name)?.[2];
      if (key !== undefined && wanted.has(key)) {
        await unlinkQuietly(name);
        removed += 1;
      }
    }
    return removed;
  }

  return {
    async add(event: SecurityEventInput): Promise<void> {
      if (!SAFE_KEY.test(event.idempotencyKey)) throw new AgentError("store_write_failed", "Refusing to spool an event with an unsafe key.");
      await writeJsonFile(join(dir, fileName(event)), SecurityEventInputSchema, event);
      const all = await names();
      if (all !== undefined && all.length > maxEvents) {
        const excess = all.slice(0, all.length - maxEvents);
        await Promise.all(excess.map(unlinkQuietly));
        await addDropped(excess.length);
      }
    },

    async peek(limit: number): Promise<SpooledEvent[]> {
      const all = (await names()) ?? [];
      const out: SpooledEvent[] = [];
      let discarded = 0;
      for (const name of all) {
        if (out.length >= limit) break;
        const read = await readJsonFile(join(dir, name), SecurityEventInputSchema, { requirePrivate: false });
        if (!read.ok) {
          // Forged, truncated or unreadable: never deliverable. Remove it so it cannot block the queue, and count it.
          await unlinkQuietly(name);
          discarded += 1;
        } else if (read.value !== undefined) out.push({ key: read.value.idempotencyKey, event: read.value });
      }
      await addDropped(discarded);
      return out;
    },

    async remove(keys: readonly string[]): Promise<void> {
      await remove(keys);
    },

    async discard(keys: readonly string[]): Promise<void> {
      await addDropped(await remove(keys));
    },

    async stats(): Promise<SpoolStats> {
      return { pending: ((await names()) ?? []).length, dropped: await readDropped() };
    },
  };
}
