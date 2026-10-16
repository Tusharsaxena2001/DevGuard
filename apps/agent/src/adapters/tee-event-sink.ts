import type { SecurityEventInput } from "@devguard/shared";
import type { EventSink } from "../ports/event-sink.js";

/**
 * Records one event in several places (the local log and the delivery spool). Every sink is attempted even if an
 * earlier one fails, so losing the local log never loses delivery or the other way round; the first failure is
 * rethrown afterwards so the caller can say a record could not be written.
 */
export function createTeeEventSink(sinks: readonly EventSink[]): EventSink {
  return {
    async record(event: SecurityEventInput): Promise<void> {
      let firstError: unknown;
      let failed = false;
      for (const sink of sinks) {
        try {
          await sink.record(event);
        } catch (error) {
          if (!failed) firstError = error;
          failed = true;
        }
      }
      if (failed) throw firstError;
    },
  };
}
