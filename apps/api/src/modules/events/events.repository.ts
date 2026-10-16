import { Inject, Injectable } from "@nestjs/common";
import type { EventQuery, Finding, SecurityEventInput } from "@devguard/shared";
import type { Prisma } from "../../prisma/generated/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";

const WITH_NAMES = {
  device: { select: { name: true } },
  project: { select: { name: true } },
} as const;

type Row = Prisma.SecurityEventGetPayload<{ include: typeof WITH_NAMES }>;

export interface EventRecord {
  readonly id: string;
  readonly occurredAt: Date;
  readonly receivedAt: Date;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly userId: string;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly destHost: string | null;
  readonly destRepo: string | null;
  readonly operation: SecurityEventInput["operation"];
  readonly refs: readonly string[];
  readonly outcome: SecurityEventInput["outcome"];
  readonly ruleIds: readonly string[];
  readonly findings: readonly Finding[];
  readonly mode: SecurityEventInput["mode"];
  readonly wouldBlock: boolean;
  readonly policyVersion: number | null;
  readonly exceptionId: string | null;
  readonly correlationId: string;
  readonly agentVersion: string;
}

export interface EventScope {
  /** Restrict to one user's events (employees see only their own). */
  readonly userId?: string;
}

/** The stored JSON was written by this API from a validated `Finding[]`; anything else reads as "no findings". */
const asFindings = (value: unknown): Finding[] => (Array.isArray(value) ? (value as Finding[]) : []);

const toRecord = (row: Row, userId = row.userId): EventRecord => ({
  id: row.id,
  occurredAt: row.occurredAt,
  receivedAt: row.receivedAt,
  deviceId: row.deviceId,
  deviceName: row.device.name,
  userId,
  projectId: row.projectId,
  projectName: row.project?.name ?? null,
  destHost: row.destHost,
  destRepo: row.destRepo,
  operation: row.operation,
  refs: row.refs,
  outcome: row.outcome,
  ruleIds: row.ruleIds,
  findings: asFindings(row.findings),
  mode: row.mode,
  wouldBlock: row.wouldBlock,
  policyVersion: row.policyVersion,
  exceptionId: row.exceptionId,
  correlationId: row.correlationId,
  agentVersion: row.agentVersion,
});

function whereFor(query: EventQuery, scope: EventScope): Prisma.SecurityEventWhereInput {
  const and: Prisma.SecurityEventWhereInput[] = [];
  if (scope.userId !== undefined) and.push({ userId: scope.userId });
  if (query.projectId !== undefined) and.push({ projectId: query.projectId });
  if (query.deviceId !== undefined) and.push({ deviceId: query.deviceId });
  if (query.userId !== undefined) and.push({ userId: query.userId });
  if (query.outcome !== undefined) and.push({ outcome: query.outcome });
  if (query.ruleId !== undefined) and.push({ ruleIds: { has: query.ruleId } });
  if (query.correlationId !== undefined) and.push({ correlationId: query.correlationId });
  if (query.destHost !== undefined) and.push({ destHost: query.destHost });
  if (query.destRepo !== undefined) and.push({ destRepo: query.destRepo });
  if (query.from !== undefined || query.to !== undefined) {
    and.push({ occurredAt: { ...(query.from === undefined ? {} : { gte: new Date(query.from) }), ...(query.to === undefined ? {} : { lte: new Date(query.to) }) } });
  }
  return { AND: and };
}

@Injectable()
export class EventsRepository {
  public constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Idempotency keys this device has already delivered, among `keys`. */
  public async existingKeys(deviceId: string, keys: readonly string[]): Promise<Set<string>> {
    const rows = await this.prisma.securityEvent.findMany({ where: { deviceId, idempotencyKey: { in: [...keys] } }, select: { idempotencyKey: true } });
    return new Set(rows.flatMap((r) => (r.idempotencyKey === null ? [] : [r.idempotencyKey])));
  }

  /**
   * Stores events for a device. Identity (`deviceId`, `userId`) comes from the credential, never from the body.
   * `skipDuplicates` + the unique (deviceId, idempotencyKey) make a concurrent redelivery harmless.
   */
  public async insert(deviceId: string, userId: string, events: readonly SecurityEventInput[], now: Date): Promise<void> {
    await this.prisma.securityEvent.createMany({
      skipDuplicates: true,
      data: events.map((e) => ({
        occurredAt: new Date(e.occurredAt),
        deviceId,
        userId,
        projectId: e.projectId,
        destHost: e.destination?.host ?? null,
        destRepo: e.destination?.repoPath ?? null,
        operation: e.operation,
        refs: [...e.refs],
        ruleIds: [...e.ruleIds],
        findings: e.findings.map((f) => ({ ...f })),
        mode: e.mode,
        wouldBlock: e.wouldBlock,
        outcome: e.outcome,
        correlationId: e.correlationId,
        policyVersion: e.policyVersion,
        exceptionId: e.exceptionId ?? null,
        agentVersion: e.agentVersion,
        idempotencyKey: e.idempotencyKey,
        receivedAt: now,
      })),
    });
  }

  public async list(query: EventQuery, scope: EventScope): Promise<{ items: EventRecord[]; total: number }> {
    const where = whereFor(query, scope);
    const [rows, total] = await Promise.all([
      this.prisma.securityEvent.findMany({
        where,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: WITH_NAMES,
      }),
      this.prisma.securityEvent.count({ where }),
    ]);
    return { items: rows.map((r) => toRecord(r)), total };
  }

  public async isOwnedBy(id: string, userId: string): Promise<boolean> {
    return (await this.prisma.securityEvent.count({ where: { id, userId } })) > 0;
  }

  public async findById(id: string, scope: EventScope): Promise<EventRecord | null> {
    const row = await this.prisma.securityEvent.findFirst({ where: { id, ...(scope.userId === undefined ? {} : { userId: scope.userId }) }, include: WITH_NAMES });
    return row ? toRecord(row) : null;
  }
}
