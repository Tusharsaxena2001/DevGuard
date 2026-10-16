import { Inject, Injectable } from "@nestjs/common";
import type { AuditQuery } from "@devguard/shared";
import type { Prisma } from "../../prisma/generated/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";

export interface AuditRecord {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly summary: unknown;
}

function whereFor(query: AuditQuery): Prisma.AdminAuditEventWhereInput {
  return {
    AND: [
      ...(query.actorId === undefined ? [] : [{ actorId: query.actorId }]),
      ...(query.action === undefined ? [] : [{ action: query.action }]),
      ...(query.actionPrefix === undefined ? [] : [{ action: { startsWith: `${query.actionPrefix}.` } }]),
      ...(query.targetType === undefined ? [] : [{ targetType: query.targetType }]),
      ...(query.targetId === undefined ? [] : [{ targetId: query.targetId }]),
      ...(query.from === undefined && query.to === undefined
        ? []
        : [{ occurredAt: { ...(query.from === undefined ? {} : { gte: new Date(query.from) }), ...(query.to === undefined ? {} : { lte: new Date(query.to) }) } }]),
    ],
  };
}

/** Read-only by design: the audit table is append-only (DB triggers) and written inside other modules' transactions. */
@Injectable()
export class AuditRepository {
  public constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  public async list(query: AuditQuery): Promise<{ items: AuditRecord[]; total: number }> {
    const where = whereFor(query);
    const [items, total] = await Promise.all([
      this.prisma.adminAuditEvent.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.adminAuditEvent.count({ where }),
    ]);
    return { items, total };
  }
}
