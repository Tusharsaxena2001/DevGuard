import { Inject, Injectable } from "@nestjs/common";
import type { ExceptionQuery, ExceptionStatus } from "@devguard/shared";
import { writeAudit } from "../../prisma/audit-write.js";
import { Prisma } from "../../prisma/generated/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";

const WITH_HISTORY = { decisions: { orderBy: { decidedAt: "asc" as const } } } as const;
type Row = Prisma.ExceptionRequestGetPayload<{ include: typeof WITH_HISTORY }>;

export interface DecisionRecord {
  readonly decision: "approved" | "rejected" | "revoked";
  readonly deciderId: string;
  readonly reason: string;
  readonly expiresAt: Date | null;
  readonly decidedAt: Date;
}

export interface ExceptionRecord {
  readonly id: string;
  readonly projectId: string;
  readonly requesterId: string;
  readonly deviceId: string | null;
  readonly destHost: string;
  readonly destRepo: string;
  readonly reason: string;
  /** Stored status. Expiry is not stored: it is derived from the latest approval (see the service). */
  readonly status: ExceptionStatus;
  readonly eventId: string | null;
  readonly createdAt: Date;
  readonly decisions: readonly DecisionRecord[];
}

const toRecord = (row: Row): ExceptionRecord => ({
  id: row.id,
  projectId: row.projectId,
  requesterId: row.requesterId,
  deviceId: row.deviceId,
  destHost: row.destHost,
  destRepo: row.destRepo,
  reason: row.reason,
  status: row.status,
  eventId: row.eventId,
  createdAt: row.createdAt,
  decisions: row.decisions.map((d) => ({ decision: d.decision, deciderId: d.deciderId, reason: d.reason, expiresAt: d.expiresAt, decidedAt: d.decidedAt })),
});

export interface NewRequest {
  readonly projectId: string;
  readonly requesterId: string;
  readonly deviceId: string | null;
  readonly destHost: string;
  readonly destRepo: string;
  readonly reason: string;
  readonly eventId: string | null;
}

export type CreateResult = { readonly ok: true; readonly request: ExceptionRecord } | { readonly ok: false; readonly reason: "already_pending" | "too_many_pending" };

export type DecideResult =
  | { readonly ok: true; readonly request: ExceptionRecord }
  | { readonly ok: false; readonly reason: "not_found" | "self_decision" | "wrong_state" };

export interface DecisionInput {
  readonly kind: "approved" | "rejected" | "revoked";
  readonly reason: string;
  readonly expiresAt: Date | null;
}

/** Per requester: stops a runaway agent or user from filling the approvers' queue. */
export const MAX_PENDING_PER_REQUESTER = 20;

const EXPECTED_STATE = { approved: "pending", rejected: "pending", revoked: "approved" } as const;

@Injectable()
export class ExceptionsRepository {
  public constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  public async create(input: NewRequest, now: Date): Promise<CreateResult> {
    try {
      return await this.createLocked(input, now);
    } catch (error) {
      // The partial unique index on pending (requester, project, destination) is the backstop for a race.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, reason: "already_pending" };
      throw error;
    }
  }

  private createLocked(input: NewRequest, now: Date): Promise<CreateResult> {
    return this.prisma.$transaction(async (tx) => {
      // Serialises one requester's requests, so the duplicate and pending-count checks below cannot be raced past.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requesterId}))`;
      const pending = await tx.exceptionRequest.findMany({ where: { requesterId: input.requesterId, status: "pending" }, select: { projectId: true, destHost: true, destRepo: true } });
      if (pending.some((p) => p.projectId === input.projectId && p.destHost === input.destHost && p.destRepo === input.destRepo)) return { ok: false, reason: "already_pending" } as const;
      if (pending.length >= MAX_PENDING_PER_REQUESTER) return { ok: false, reason: "too_many_pending" } as const;
      const row = await tx.exceptionRequest.create({ data: { ...input, createdAt: now }, include: WITH_HISTORY });
      await writeAudit(tx, {
        occurredAt: now,
        actorId: input.requesterId,
        action: "exception.requested",
        targetType: "exception",
        targetId: row.id,
        summary: { projectId: input.projectId, host: input.destHost, repoPath: input.destRepo, viaDevice: input.deviceId !== null },
      });
      return { ok: true, request: toRecord(row) } as const;
    });
  }

  public async findById(id: string): Promise<ExceptionRecord | null> {
    const row = await this.prisma.exceptionRequest.findUnique({ where: { id }, include: WITH_HISTORY });
    return row ? toRecord(row) : null;
  }

  public async list(query: ExceptionQuery, scope: { requesterId?: string }, now: Date): Promise<{ items: ExceptionRecord[]; total: number }> {
    // `expired` is not stored: it is an approved request whose approval ran out. A request is approved exactly once
    // (pending -> approved), so "has an approval still in force" is a plain existence check.
    const approvalInForce: Prisma.ExceptionRequestWhereInput = { decisions: { some: { decision: "approved", expiresAt: { gt: now } } } };
    const where: Prisma.ExceptionRequestWhereInput = {
      ...(scope.requesterId === undefined ? {} : { requesterId: scope.requesterId }),
      ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
      ...(query.status === undefined ? {} : { status: query.status === "expired" ? "approved" : query.status }),
      ...(query.status === "approved" ? approvalInForce : {}),
      ...(query.status === "expired" ? { NOT: approvalInForce } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.exceptionRequest.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: WITH_HISTORY }),
      this.prisma.exceptionRequest.count({ where }),
    ]);
    return { items: rows.map(toRecord), total };
  }

  /**
   * Records a decision. The state check, the status change, the decision row and the audit row are one transaction, and
   * the status change is conditional (`WHERE status = expected`), so two admins deciding at once cannot both win.
   * The requester can never decide their own request (approver != requester).
   */
  public async decide(id: string, actorId: string, input: DecisionInput, now: Date): Promise<DecideResult> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.exceptionRequest.findUnique({ where: { id }, select: { requesterId: true, status: true, projectId: true, destHost: true, destRepo: true } });
      if (!current) return { ok: false, reason: "not_found" } as const;
      if (input.kind !== "revoked" && current.requesterId === actorId) return { ok: false, reason: "self_decision" } as const;
      const claimed = await tx.exceptionRequest.updateMany({ where: { id, status: EXPECTED_STATE[input.kind] }, data: { status: input.kind } });
      if (claimed.count !== 1) return { ok: false, reason: "wrong_state" } as const;
      await tx.exceptionDecision.create({ data: { requestId: id, deciderId: actorId, decision: input.kind, reason: input.reason, expiresAt: input.expiresAt, decidedAt: now } });
      await writeAudit(tx, {
        occurredAt: now,
        actorId,
        action: `exception.${input.kind}`,
        targetType: "exception",
        targetId: id,
        summary: {
          projectId: current.projectId,
          host: current.destHost,
          repoPath: current.destRepo,
          requesterId: current.requesterId,
          ...(input.expiresAt === null ? {} : { expiresAt: input.expiresAt.toISOString() }),
        },
      });
      const row = await tx.exceptionRequest.findUniqueOrThrow({ where: { id }, include: WITH_HISTORY });
      return { ok: true, request: toRecord(row) } as const;
    });
  }

  /** Approved requests of this requester for exactly this project and destination. */
  public async approvedFor(requesterId: string, projectId: string, destHost: string, destRepo: string): Promise<ExceptionRecord[]> {
    const rows = await this.prisma.exceptionRequest.findMany({ where: { requesterId, projectId, destHost, destRepo, status: "approved" }, include: WITH_HISTORY });
    return rows.map(toRecord);
  }
}
