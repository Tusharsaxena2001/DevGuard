import type { Prisma } from "./generated/client.js";

/** Redacted, flat summary only: ids, names and status words. Never credentials, tokens or file contents. */
export type AuditSummary = Readonly<Record<string, string | number | boolean | null>>;

export interface AuditEntry {
  readonly occurredAt: Date;
  readonly actorId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly summary: AuditSummary;
}

/**
 * Appends an admin audit row inside the caller's transaction, so a change and its audit record commit or fail together.
 * Repositories call this from their `$transaction`; the table itself is append-only (DB triggers).
 */
export async function writeAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.adminAuditEvent.create({ data: { ...entry, summary: { ...entry.summary } } });
}
