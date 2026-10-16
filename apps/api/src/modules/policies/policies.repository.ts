import { Inject, Injectable } from "@nestjs/common";
import type { EnforcementMode } from "@devguard/shared";
import { writeAudit } from "../../prisma/audit-write.js";
import { Prisma } from "../../prisma/generated/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";

export interface PolicyVersionRecord {
  readonly projectId: string;
  readonly version: number;
  readonly mode: EnforcementMode;
  readonly prohibitedGlobs: readonly string[];
  readonly secretRules: readonly string[];
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface NewPolicyVersion {
  readonly baseVersion: number;
  readonly mode: EnforcementMode;
  readonly prohibitedGlobs: readonly string[];
  readonly secretRules: readonly string[];
}

export type CreateVersionResult =
  | { readonly ok: true; readonly version: PolicyVersionRecord }
  | { readonly ok: false; readonly reason: "not_found" }
  | { readonly ok: false; readonly reason: "conflict"; readonly currentVersion: number };

type Row = {
  projectId: string;
  version: number;
  mode: EnforcementMode;
  prohibitedGlobs: string[];
  secretRules: unknown;
  createdBy: string;
  createdAt: Date;
};

/** `secretRules` is stored as JSON; anything that is not an array of strings reads as "no rules" (fail toward fewer, never crash). */
const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

const toRecord = (row: Row): PolicyVersionRecord => ({
  projectId: row.projectId,
  version: row.version,
  mode: row.mode,
  prohibitedGlobs: row.prohibitedGlobs,
  secretRules: asStrings(row.secretRules),
  createdBy: row.createdBy,
  createdAt: row.createdAt,
});

@Injectable()
export class PoliciesRepository {
  public constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** The highest version of each project's policy. */
  public async currentFor(projectIds: readonly string[]): Promise<PolicyVersionRecord[]> {
    const rows = await this.prisma.policyVersion.findMany({
      where: { projectId: { in: [...projectIds] } },
      orderBy: [{ projectId: "asc" }, { version: "desc" }],
      distinct: ["projectId"],
    });
    return rows.map(toRecord);
  }

  public async versions(projectId: string): Promise<PolicyVersionRecord[]> {
    return (await this.prisma.policyVersion.findMany({ where: { projectId }, orderBy: { version: "desc" } })).map(toRecord);
  }

  /**
   * Appends version `baseVersion + 1`. The check and the insert share a transaction, and `unique(projectId, version)`
   * makes a concurrent editor lose with a conflict rather than overwrite. Versions are immutable (DB trigger).
   */
  public async createVersion(projectId: string, next: NewPolicyVersion, actorId: string, now: Date): Promise<CreateVersionResult> {
    try {
      return await this.insertNextVersion(projectId, next, actorId, now);
    } catch (error) {
      // Two editors read the same base at once: the unique (projectId, version) constraint lets one win. The loser conflicts.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { ok: false, reason: "conflict", currentVersion: next.baseVersion + 1 };
      }
      throw error;
    }
  }

  private insertNextVersion(projectId: string, next: NewPolicyVersion, actorId: string, now: Date): Promise<CreateVersionResult> {
    return this.prisma.$transaction(async (tx) => {
      const policy = await tx.policy.findUnique({ where: { projectId }, select: { id: true } });
      if (!policy) return { ok: false, reason: "not_found" } as const;
      const current = await tx.policyVersion.findFirstOrThrow({ where: { projectId }, orderBy: { version: "desc" } });
      if (current.version !== next.baseVersion) return { ok: false, reason: "conflict", currentVersion: current.version } as const;
      const created = await tx.policyVersion.create({
        data: {
          policyId: policy.id,
          projectId,
          version: current.version + 1,
          mode: next.mode,
          prohibitedGlobs: [...next.prohibitedGlobs],
          secretRules: [...next.secretRules],
          createdBy: actorId,
          createdAt: now,
        },
      });
      await writeAudit(tx, {
        occurredAt: now,
        actorId,
        action: "policy.updated",
        targetType: "project",
        targetId: projectId,
        summary: {
          fromVersion: current.version,
          toVersion: created.version,
          beforeMode: current.mode,
          afterMode: created.mode,
          beforeGlobs: current.prohibitedGlobs.length,
          afterGlobs: created.prohibitedGlobs.length,
          beforeSecretRules: asStrings(current.secretRules).length,
          afterSecretRules: asStrings(created.secretRules).length,
        },
      });
      return { ok: true, version: toRecord(created) } as const;
    });
  }
}
