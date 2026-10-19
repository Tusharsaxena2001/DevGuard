import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "../../prisma/generated/client.js";
import { writeAudit } from "../../prisma/audit-write.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { UserRecord } from "./user.record.js";

const WITH_MEMBERSHIPS = { memberships: { select: { role: true, projectId: true } } } as const;

export interface NewUser {
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly isAdmin: boolean;
}

export type CreateUserResult = { readonly ok: true; readonly user: UserRecord } | { readonly ok: false; readonly reason: "email_taken" };

@Injectable()
export class UsersRepository {
  public constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  public findByEmail(email: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { email }, include: WITH_MEMBERSHIPS });
  }

  public findById(id: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { id }, include: WITH_MEMBERSHIPS });
  }

  public findManyByIds(ids: readonly string[]): Promise<UserRecord[]> {
    return this.prisma.user.findMany({ where: { id: { in: [...ids] } }, include: WITH_MEMBERSHIPS });
  }

  /** Emails of active users holding the global security_admin role (project-scoped roles are not evaluated, ADR-014). */
  public async findActiveAdminEmails(): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { status: "active", memberships: { some: { role: "security_admin", projectId: null } } },
      select: { email: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => r.email);
  }

  public list(): Promise<UserRecord[]> {
    return this.prisma.user.findMany({ orderBy: { createdAt: "asc" }, include: WITH_MEMBERSHIPS });
  }

  /** Creates the user, its global membership and the audit row in one transaction. */
  public async create(input: NewUser, actorId: string, now: Date): Promise<CreateUserResult> {
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: input.email,
            name: input.name,
            passwordHash: input.passwordHash,
            createdAt: now,
            memberships: { create: { role: input.isAdmin ? "security_admin" : "employee", projectId: null } },
          },
          include: WITH_MEMBERSHIPS,
        });
        await writeAudit(tx, {
          occurredAt: now,
          actorId,
          action: "user.created",
          targetType: "user",
          targetId: created.id,
          summary: { email: created.email, isAdmin: input.isAdmin },
        });
        return created;
      });
      return { ok: true, user };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, reason: "email_taken" };
      throw error;
    }
  }
}
