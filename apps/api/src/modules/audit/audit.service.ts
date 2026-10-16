import { Inject, Injectable } from "@nestjs/common";
import type { AuditEntry, AuditPage, AuditQuery } from "@devguard/shared";
import { UsersService } from "../users/users.service.js";
import { AuditRepository, type AuditRecord } from "./audit.repository.js";

type Summary = AuditEntry["summary"];

/** Summaries are written by this API as flat records; anything else (it cannot happen) reads as empty rather than leaking structure. */
function flatSummary(value: unknown): Summary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[key] = v;
  }
  return out;
}

@Injectable()
export class AuditService {
  public constructor(
    @Inject(AuditRepository) private readonly repo: AuditRepository,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  public async list(query: AuditQuery): Promise<AuditPage> {
    const { items, total } = await this.repo.list(query);
    const names = await this.users.namesById([...new Set(items.map((i) => i.actorId))]);
    return { items: items.map((i) => toEntry(i, names.get(i.actorId) ?? "unknown")), total, page: query.page, pageSize: query.pageSize };
  }
}

const toEntry = (r: AuditRecord, actorName: string): AuditEntry => ({
  id: r.id,
  occurredAt: r.occurredAt.toISOString(),
  actorId: r.actorId,
  actorName,
  action: r.action,
  targetType: r.targetType,
  targetId: r.targetId,
  summary: flatSummary(r.summary),
});
