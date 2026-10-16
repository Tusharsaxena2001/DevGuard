import { Inject, Injectable } from "@nestjs/common";
import type { Outcome } from "@devguard/shared";
import { PrismaService } from "../../prisma/prisma.service.js";

export interface MetricsData {
  readonly outcomes: ReadonlyMap<Outcome, number>;
  readonly topRules: readonly { ruleId: string; count: number }[];
  readonly blockedPerDay: readonly { day: string; projectId: string | null; projectName: string | null; blocked: number }[];
  readonly pendingExceptions: number;
  readonly exceptionsInForce: number;
  readonly devices: { active: number; stale: number; revoked: number };
}

/**
 * Aggregates computed from the tables on request: nothing is cached or hard-coded, so the numbers always match the
 * data. Raw SQL is parameterised (tagged templates); only counts and ids leave this class.
 */
@Injectable()
export class MetricsRepository {
  public constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  public async collect(since: Date, now: Date, staleBefore: Date): Promise<MetricsData> {
    const [outcomeRows, topRules, blockedPerDay, pending, inForce, active, stale, revoked] = await Promise.all([
      this.prisma.securityEvent.groupBy({ by: ["outcome"], where: { occurredAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.$queryRaw<{ ruleId: string; count: number }[]>`
        SELECT r AS "ruleId", COUNT(*)::int AS count
        FROM "SecurityEvent" e, unnest(e."ruleIds") AS r
        WHERE e."occurredAt" >= ${since}
        GROUP BY r ORDER BY count DESC, r ASC LIMIT 10`,
      this.prisma.$queryRaw<{ day: string; projectId: string | null; projectName: string | null; blocked: number }[]>`
        SELECT to_char(date_trunc('day', e."occurredAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
               e."projectId"::text AS "projectId", p."name" AS "projectName", COUNT(*)::int AS blocked
        FROM "SecurityEvent" e LEFT JOIN "Project" p ON p."id" = e."projectId"
        WHERE e."outcome" = 'blocked' AND e."occurredAt" >= ${since}
        GROUP BY 1, 2, 3 ORDER BY 1 DESC, blocked DESC`,
      this.prisma.exceptionRequest.count({ where: { status: "pending" } }),
      this.prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM "ExceptionRequest" r
        WHERE r."status" = 'approved'
          AND (SELECT d."expiresAt" FROM "ExceptionDecision" d WHERE d."requestId" = r."id" AND d."decision" = 'approved' ORDER BY d."decidedAt" DESC LIMIT 1) > ${now}`,
      this.prisma.device.count({ where: { status: "active", lastSeenAt: { gte: staleBefore } } }),
      this.prisma.device.count({ where: { status: "active", OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: staleBefore } }] } }),
      this.prisma.device.count({ where: { status: "revoked" } }),
    ]);
    return {
      outcomes: new Map(outcomeRows.map((r) => [r.outcome, r._count._all])),
      topRules,
      blockedPerDay,
      pendingExceptions: pending,
      exceptionsInForce: inForce[0]?.count ?? 0,
      devices: { active, stale, revoked },
    };
  }
}
