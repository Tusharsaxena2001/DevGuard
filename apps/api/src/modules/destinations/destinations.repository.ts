import { Inject, Injectable } from "@nestjs/common";
import type { NormalizedDestination } from "@devguard/shared";
import { writeAudit } from "../../prisma/audit-write.js";
import { Prisma } from "../../prisma/generated/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";

export interface DestinationRecord {
  readonly id: string;
  readonly projectId: string;
  readonly host: string;
  readonly repoPath: string;
  readonly type: "exact" | "owner_wildcard";
  readonly createdAt: Date;
}

export interface CanonicalRepoRecord {
  readonly id: string;
  readonly projectId: string;
  readonly host: string;
  readonly repoPath: string;
  readonly createdAt: Date;
}

export type AddResult<T> = { readonly ok: true; readonly entry: T } | { readonly ok: false; readonly reason: "duplicate" };

const isDuplicate = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

@Injectable()
export class DestinationsRepository {
  public constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  public listDestinations(projectIds: readonly string[]): Promise<DestinationRecord[]> {
    return this.prisma.approvedDestination.findMany({ where: { projectId: { in: [...projectIds] } }, orderBy: [{ host: "asc" }, { repoPath: "asc" }] });
  }

  public listCanonicalRepos(projectIds: readonly string[]): Promise<CanonicalRepoRecord[]> {
    return this.prisma.canonicalRepo.findMany({ where: { projectId: { in: [...projectIds] } }, orderBy: [{ host: "asc" }, { repoPath: "asc" }] });
  }

  public async addDestination(projectId: string, dest: NormalizedDestination, actorId: string, now: Date): Promise<AddResult<DestinationRecord>> {
    try {
      const entry = await this.prisma.$transaction(async (tx) => {
        const row = await tx.approvedDestination.create({
          data: { projectId, host: dest.host, repoPath: dest.repoPath, type: "exact", createdBy: actorId, createdAt: now },
        });
        await writeAudit(tx, {
          occurredAt: now,
          actorId,
          action: "destination.added",
          targetType: "project",
          targetId: projectId,
          summary: { host: dest.host, repoPath: dest.repoPath },
        });
        return row;
      });
      return { ok: true, entry };
    } catch (error) {
      if (isDuplicate(error)) return { ok: false, reason: "duplicate" };
      throw error;
    }
  }

  /** Deletes within the project only (an id from another project is "not found"). False if nothing was deleted. */
  public removeDestination(projectId: string, id: string, actorId: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.approvedDestination.findFirst({ where: { id, projectId } });
      if (!row) return false;
      await tx.approvedDestination.delete({ where: { id } });
      await writeAudit(tx, {
        occurredAt: now,
        actorId,
        action: "destination.removed",
        targetType: "project",
        targetId: projectId,
        summary: { host: row.host, repoPath: row.repoPath },
      });
      return true;
    });
  }

  public async addCanonicalRepo(projectId: string, dest: NormalizedDestination, actorId: string, now: Date): Promise<AddResult<CanonicalRepoRecord>> {
    try {
      const entry = await this.prisma.$transaction(async (tx) => {
        const row = await tx.canonicalRepo.create({ data: { projectId, host: dest.host, repoPath: dest.repoPath, createdBy: actorId, createdAt: now } });
        await writeAudit(tx, {
          occurredAt: now,
          actorId,
          action: "canonical_repo.added",
          targetType: "project",
          targetId: projectId,
          summary: { host: dest.host, repoPath: dest.repoPath },
        });
        return row;
      });
      return { ok: true, entry };
    } catch (error) {
      if (isDuplicate(error)) return { ok: false, reason: "duplicate" };
      throw error;
    }
  }

  public removeCanonicalRepo(projectId: string, id: string, actorId: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.canonicalRepo.findFirst({ where: { id, projectId } });
      if (!row) return false;
      await tx.canonicalRepo.delete({ where: { id } });
      await writeAudit(tx, {
        occurredAt: now,
        actorId,
        action: "canonical_repo.removed",
        targetType: "project",
        targetId: projectId,
        summary: { host: row.host, repoPath: row.repoPath },
      });
      return true;
    });
  }
}
