import type { Clock } from "../ports/clock.js";
import type { ConfigStore } from "../ports/config-store.js";

/** Remembers that the server just answered this device. Best effort: a failure here never matters to the caller. */
export async function recordContact(store: ConfigStore, clock: Clock): Promise<void> {
  try {
    const config = await store.readConfig();
    if (!config.ok || config.value === undefined) return;
    await store.writeConfig({ ...config.value, lastContactAt: clock.now().toISOString() });
  } catch {
    // Informational only.
  }
}
