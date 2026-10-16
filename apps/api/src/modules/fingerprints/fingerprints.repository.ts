import { Inject, Injectable } from "@nestjs/common";
import { writeAudit } from "../../prisma/audit-write.js";
import { Prisma } from "../../prisma/generated/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";

export interface FingerprintRecord {
  readonly id: string;
  readonly projectId: string;
  readonly fingerprint: string;
  readonly source: "device" | "manual";
  readonly reportedByDeviceId: string | null;
  readonly createdAt: Date;
}

export interface RegistrationRecord {
  readonly id: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly fingerprint: string;
  readonly registeredAt: Date;
}

/** Matches `AgentProjectSchema.fingerprints.max(1000)`: past this a sync body would no longer parse for any member. */
export const MAX_FINGERPRINTS_PER_PROJECT = 1000;

export type AddManualResult = { readonly ok: true; readonly row: FingerprintRecord } | { readonly ok: false; readonly reason: "duplicate" | "limit" };

const isDuplicate = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

@Injectable()
export class FingerprintsRepository {
  public constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  public list(projectIds: readonly string[]): Promise<FingerprintRecord[]> {
    return this.prisma.projectFingerprint.findMany({ where: { projectId: { in: [...projectIds] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  }

  /** Manual add by an admin. Refused if the project already has it or is at the limit. */
  public async addManual(projectId: string, fingerprint: string, actorId: string, now: Date): Promise<AddManualResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if ((await tx.projectFingerprint.count({ where: { projectId } })) >= MAX_FINGERPRINTS_PER_PROJECT) return { ok: false, reason: "limit" } as const;
        const row = await tx.projectFingerprint.create({ data: { projectId, fingerprint, source: "manual", createdBy: actorId, createdAt: now } });
        await writeAudit(tx, { occurredAt: now, actorId, action: "fingerprint.added", targetType: "project", targetId: projectId, summary: { fingerprint, source: "manual" } });
        return { ok: true, row } as const;
      });
    } catch (error) {
      if (isDuplicate(error)) return { ok: false, reason: "duplicate" };
      throw error;
    }
  }

  /** Device-reported fingerprint. Idempotent: an existing one is left as it is and not audited again. "limit" if the project is full. */
  public async addFromDevice(projectId: string, fingerprint: string, deviceId: string, ownerId: string, now: Date): Promise<"added" | "exists" | "limit"> {
    return this.prisma.$transaction(async (tx) => {
      if (await tx.projectFingerprint.findUnique({ where: { projectId_fingerprint: { projectId, fingerprint } }, select: { id: true } })) return "exists" as const;
      if ((await tx.projectFingerprint.count({ where: { projectId } })) >= MAX_FINGERPRINTS_PER_PROJECT) return "limit" as const;
      await tx.projectFingerprint.create({ data: { projectId, fingerprint, source: "device", reportedByDeviceId: deviceId, createdAt: now } });
      await writeAudit(tx, {
        occurredAt: now,
        actorId: ownerId,
        action: "fingerprint.reported",
        targetType: "project",
        targetId: projectId,
        summary: { fingerprint, source: "device", deviceId },
      });
      return "added" as const;
    });
  }

  public async remove(projectId: string, id: string, actorId: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.projectFingerprint.findFirst({ where: { id, projectId } });
      if (!row) return false;
      await tx.projectFingerprint.delete({ where: { id } });
      await writeAudit(tx, {
        occurredAt: now,
        actorId,
        action: "fingerprint.removed",
        targetType: "project",
        targetId: projectId,
        summary: { fingerprint: row.fingerprint, source: row.source },
      });
      return true;
    });
  }

  /** Manual registration of a device's repo (fallback). Idempotent per device + fingerprint. */
  public async register(projectId: string, deviceId: string, ownerId: string, fingerprint: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.repoRegistration.findUnique({ where: { deviceId_repoFingerprint: { deviceId, repoFingerprint: fingerprint } } });
      if (existing?.projectId === projectId) return;
      await tx.repoRegistration.upsert({
        where: { deviceId_repoFingerprint: { deviceId, repoFingerprint: fingerprint } },
        create: { projectId, deviceId, repoFingerprint: fingerprint, registeredAt: now },
        update: { projectId, registeredAt: now },
      });
      await writeAudit(tx, {
        occurredAt: now,
        actorId: ownerId,
        action: "repo.registered",
        targetType: "project",
        targetId: projectId,
        summary: { fingerprint, deviceId },
      });
    });
  }

  public async listRegistrations(projectId: string): Promise<RegistrationRecord[]> {
    const rows = await this.prisma.repoRegistration.findMany({
      where: { projectId },
      orderBy: { registeredAt: "desc" },
      include: { device: { select: { name: true } } },
    });
    return rows.map((r) => ({ id: r.id, deviceId: r.deviceId, deviceName: r.device.name, fingerprint: r.repoFingerprint, registeredAt: r.registeredAt }));
  }
}
