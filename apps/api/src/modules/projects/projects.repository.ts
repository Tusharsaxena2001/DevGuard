import { Inject, Injectable } from "@nestjs/common";
import { DEFAULT_PROHIBITED_GLOBS, DEFAULT_SECRET_RULE_IDS } from "@devguard/policy-engine";
import type { Classification } from "@devguard/shared";
import { writeAudit } from "../../prisma/audit-write.js";
import { Prisma } from "../../prisma/generated/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { ProjectRecord } from "./project.record.js";

const WITH_MEMBERS = { memberships: { where: { role: "employee" as const }, select: { userId: true } } } as const;

type Row = Prisma.ProjectGetPayload<{ include: typeof WITH_MEMBERS }>;

const toRecord = (row: Row): ProjectRecord => ({
  id: row.id,
  name: row.name,
  classification: row.classification,
  ownerId: row.ownerId,
  createdAt: row.createdAt,
  memberIds: row.memberships.map((m) => m.userId),
});

export type CreateProjectResult = { readonly ok: true; readonly project: ProjectRecord } | { readonly ok: false; readonly reason: "name_taken" };
export type UpdateProjectResult = CreateProjectResult | { readonly ok: false; readonly reason: "not_found" };
export type SetMembersResult = { readonly ok: true; readonly project: ProjectRecord } | { readonly ok: false; readonly reason: "not_found" | "unknown_user" };

@Injectable()
export class ProjectsRepository {
  public constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  public async findById(id: string): Promise<ProjectRecord | null> {
    const row = await this.prisma.project.findUnique({ where: { id }, include: WITH_MEMBERS });
    return row ? toRecord(row) : null;
  }

  public async list(): Promise<ProjectRecord[]> {
    return (await this.prisma.project.findMany({ orderBy: { createdAt: "asc" }, include: WITH_MEMBERS })).map(toRecord);
  }

  public async findManyByIds(ids: readonly string[]): Promise<ProjectRecord[]> {
    return (await this.prisma.project.findMany({ where: { id: { in: [...ids] } }, orderBy: { name: "asc" }, include: WITH_MEMBERS })).map(toRecord);
  }

  /** Projects an employee is assigned to. */
  public async listAssignedIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.membership.findMany({ where: { userId, role: "employee", projectId: { not: null } }, select: { projectId: true } });
    return rows.flatMap((r) => (r.projectId === null ? [] : [r.projectId]));
  }

  public async isAssigned(userId: string, projectId: string): Promise<boolean> {
    return (await this.prisma.membership.count({ where: { userId, projectId, role: "employee" } })) > 0;
  }

  /**
   * Creates the project and its first policy version (enforce, default globs and secret rules) together, so every
   * project always has a policy to sync. The creator owns it.
   */
  public async create(input: { name: string; classification: Classification }, actorId: string, now: Date): Promise<CreateProjectResult> {
    try {
      const project = await this.prisma.$transaction(async (tx) => {
        const row = await tx.project.create({
          data: { name: input.name, classification: input.classification, ownerId: actorId, createdAt: now },
          include: WITH_MEMBERS,
        });
        const policy = await tx.policy.create({ data: { projectId: row.id, createdAt: now }, select: { id: true } });
        await tx.policyVersion.create({
          data: {
            policyId: policy.id,
            projectId: row.id,
            version: 1,
            mode: "enforce",
            prohibitedGlobs: [...DEFAULT_PROHIBITED_GLOBS],
            secretRules: [...DEFAULT_SECRET_RULE_IDS],
            createdBy: actorId,
            createdAt: now,
          },
        });
        await writeAudit(tx, {
          occurredAt: now,
          actorId,
          action: "project.created",
          targetType: "project",
          targetId: row.id,
          summary: { name: row.name, classification: row.classification },
        });
        return row;
      });
      return { ok: true, project: toRecord(project) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, reason: "name_taken" };
      throw error;
    }
  }

  public async update(id: string, patch: { name?: string | undefined; classification?: Classification | undefined }, actorId: string, now: Date): Promise<UpdateProjectResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await tx.project.findUnique({ where: { id }, select: { name: true, classification: true } });
        if (!before) return { ok: false, reason: "not_found" } as const;
        const row = await tx.project.update({
          where: { id },
          data: { ...(patch.name === undefined ? {} : { name: patch.name }), ...(patch.classification === undefined ? {} : { classification: patch.classification }) },
          include: WITH_MEMBERS,
        });
        await writeAudit(tx, {
          occurredAt: now,
          actorId,
          action: "project.updated",
          targetType: "project",
          targetId: id,
          summary: { beforeName: before.name, afterName: row.name, beforeClassification: before.classification, afterClassification: row.classification },
        });
        return { ok: true, project: toRecord(row) } as const;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, reason: "name_taken" };
      throw error;
    }
  }

  /** Replaces the project's employee assignments. Every id must be an existing, active user. */
  public async setMembers(projectId: string, userIds: readonly string[], actorId: string, now: Date): Promise<SetMembersResult> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.project.findUnique({ where: { id: projectId }, select: { id: true } }))) return { ok: false, reason: "not_found" } as const;
      const wanted = [...new Set(userIds)];
      if ((await tx.user.count({ where: { id: { in: wanted }, status: "active" } })) !== wanted.length) return { ok: false, reason: "unknown_user" } as const;
      const current = (await tx.membership.findMany({ where: { projectId, role: "employee" }, select: { userId: true } })).map((m) => m.userId);
      const added = wanted.filter((id) => !current.includes(id));
      const removed = current.filter((id) => !wanted.includes(id));
      await tx.membership.deleteMany({ where: { projectId, role: "employee", userId: { in: removed } } });
      await tx.membership.createMany({ data: added.map((userId) => ({ userId, role: "employee" as const, projectId })), skipDuplicates: true });
      if (added.length > 0 || removed.length > 0) {
        await writeAudit(tx, {
          occurredAt: now,
          actorId,
          action: "project.members_changed",
          targetType: "project",
          targetId: projectId,
          summary: { added: added.join(","), removed: removed.join(","), total: wanted.length },
        });
      }
      const row = await tx.project.findUniqueOrThrow({ where: { id: projectId }, include: WITH_MEMBERS });
      return { ok: true, project: toRecord(row) } as const;
    });
  }
}
