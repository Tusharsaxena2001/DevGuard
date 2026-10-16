import type { SecurityEventInput } from "@devguard/shared";

export interface SpooledEvent {
  /** The event's idempotency key; identifies it for removal. */
  readonly key: string;
  readonly event: SecurityEventInput;
}

export interface SpoolStats {
  readonly pending: number;
  /** Events discarded because the spool was full or an entry was unreadable. Never reset, so loss stays visible. */
  readonly dropped: number;
}

/**
 * Events waiting for delivery (ADR-004: delivery failure never changes a push decision). Bounded: when full, the
 * oldest events are dropped and counted. Reads never throw; an unreadable entry is discarded and counted.
 */
export interface EventSpool {
  /** Throws `AgentError("store_write_failed")` if the event cannot be stored. */
  add(event: SecurityEventInput): Promise<void>;
  /** Oldest first. */
  peek(limit: number): Promise<SpooledEvent[]>;
  /** Delivered (or answered for): gone, not counted as lost. */
  remove(keys: readonly string[]): Promise<void>;
  /** Removed without being delivered (the server refused them): gone and counted as lost, so the loss stays visible. */
  discard(keys: readonly string[]): Promise<void>;
  stats(): Promise<SpoolStats>;
}
