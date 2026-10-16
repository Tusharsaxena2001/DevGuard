import type { SecurityEventInput } from "@devguard/shared";
import type { ApiClient, ApiFailure, DeviceAuth } from "../ports/api-client.js";
import type { Clock } from "../ports/clock.js";
import type { ConfigStore } from "../ports/config-store.js";
import type { EventSpool } from "../ports/event-spool.js";
import { loadEnrollment } from "./load-enrollment.js";
import { recordContact } from "./record-contact.js";

export type DeliveryOutcome =
  | { readonly state: "delivered"; readonly sent: number; readonly refused: number; readonly remaining: number }
  | { readonly state: "nothing_pending" }
  | { readonly state: "not_enrolled" }
  | { readonly state: "unusable_state" }
  | { readonly state: "failed"; readonly reason: ApiFailure; readonly sent: number; readonly refused: number; readonly remaining: number };

export interface DeliverDeps {
  readonly store: ConfigStore;
  readonly spool: EventSpool;
  readonly api: ApiClient;
  readonly clock: Clock;
  /** Requests per run (default 5). The hook passes 1 so a push is never held up by a backlog. */
  readonly maxBatches?: number;
}

const BATCH_EVENTS = 50;
/** Stay well under the server's 2 MB body limit. */
const BATCH_BYTES = 900_000;
/** Bounds the time one command or push can spend delivering. */
const MAX_BATCHES_PER_RUN = 5;

/**
 * Sends spooled events to the server. A key is removed from the spool once the server has answered for it
 * (`accepted`, `duplicate`, or `rejected`: a final answer). Any failure leaves the spool untouched for the next
 * attempt, and redelivery is safe because the server de-duplicates by key. Never changes a push decision.
 */
export async function deliverEvents(deps: DeliverDeps): Promise<DeliveryOutcome> {
  const enrollment = await loadEnrollment(deps.store);
  if (!enrollment.ok) return { state: enrollment.reason === "not_enrolled" ? "not_enrolled" : "unusable_state" };

  const tally = { sent: 0, refused: 0 };
  const maxBatches = deps.maxBatches ?? MAX_BATCHES_PER_RUN;
  for (let n = 0; n < maxBatches; n++) {
    const pending = await deps.spool.peek(BATCH_EVENTS);
    if (pending.length === 0) return tally.sent + tally.refused === 0 ? { state: "nothing_pending" } : { state: "delivered", ...tally, remaining: 0 };

    const batch = withinBudget(pending.map((p) => p.event));
    const reply = await deps.api.sendEvents(enrollment.value, { events: batch });
    // A 4xx for the whole batch (not 401/429) means something in it is unacceptable to the server. Find the offender by
    // sending the events one at a time, so one bad event cannot stall everything queued behind it.
    if (!reply.ok && reply.reason === "rejected" && batch.length > 1) {
      const isolated = await isolatePoison(deps, enrollment.value, batch, tally);
      if (isolated === "stop") return { state: "failed", reason: "rejected", ...tally, remaining: (await deps.spool.stats()).pending };
      continue;
    }
    if (!reply.ok && reply.reason === "rejected") {
      await deps.spool.discard(batch.map((e) => e.idempotencyKey));
      tally.refused += batch.length;
      continue;
    }
    if (!reply.ok) return { state: "failed", reason: reply.reason, ...tally, remaining: (await deps.spool.stats()).pending };

    const settled = await settle(deps, batch, reply.value.results, tally);
    await recordContact(deps.store, deps.clock);
    // An answer that covers nothing (a server bug) must not spin this loop.
    if (settled === 0) return { state: "failed", reason: "invalid_response", ...tally, remaining: (await deps.spool.stats()).pending };
  }
  return { state: "delivered", ...tally, remaining: (await deps.spool.stats()).pending };
}

type Answer = { idempotencyKey: string; status: "accepted" | "duplicate" | "rejected" };

/** Applies the server's per-event answers: accepted/duplicate leave the spool; rejected are discarded and counted as lost. */
async function settle(deps: DeliverDeps, batch: readonly SecurityEventInput[], results: readonly Answer[], tally: { sent: number; refused: number }): Promise<number> {
  const sentKeys = new Set(batch.map((e) => e.idempotencyKey));
  const relevant = results.filter((r) => sentKeys.has(r.idempotencyKey));
  const refused = relevant.filter((r) => r.status === "rejected").map((r) => r.idempotencyKey);
  const delivered = relevant.filter((r) => r.status !== "rejected").map((r) => r.idempotencyKey);
  await deps.spool.remove(delivered);
  await deps.spool.discard(refused);
  tally.sent += delivered.length;
  tally.refused += refused.length;
  return relevant.length;
}

/** The whole batch was refused: try each event alone. Events the server still refuses are discarded (and counted). */
async function isolatePoison(deps: DeliverDeps, auth: DeviceAuth, batch: readonly SecurityEventInput[], tally: { sent: number; refused: number }): Promise<"done" | "stop"> {
  for (const event of batch) {
    const single = await deps.api.sendEvents(auth, { events: [event] });
    if (single.ok) {
      await settle(deps, [event], single.value.results, tally);
    } else if (single.reason === "rejected") {
      await deps.spool.discard([event.idempotencyKey]);
      tally.refused += 1;
    } else {
      return "stop"; // the server became unreachable meanwhile: keep the rest queued
    }
  }
  return "done";
}

/** The oldest events that fit one request; always at least one. */
function withinBudget<T>(events: readonly T[]): T[] {
  const out: T[] = [];
  let bytes = 0;
  for (const event of events) {
    bytes += JSON.stringify(event).length + 1;
    if (out.length > 0 && bytes > BATCH_BYTES) break;
    out.push(event);
  }
  return out;
}
