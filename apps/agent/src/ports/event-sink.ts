import type { SecurityEventInput } from "@devguard/shared";

/** Where push events go. Recording must never change a push decision (ADR-004). */
export interface EventSink {
  record(event: SecurityEventInput): Promise<void>;
}
