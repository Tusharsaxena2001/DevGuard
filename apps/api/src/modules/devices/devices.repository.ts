import { Inject, Injectable } from "@nestjs/common";
import { writeAudit } from "../../prisma/audit-write.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { DeviceAuthRecord, DeviceRecord } from "./device.record.js";

const DEVICE_FIELDS = { id: true, userId: true, name: true, os: true, agentVersion: true, status: true, enrolledAt: true, lastSeenAt: true, revokedAt: true } as const;

export interface NewEnrollmentToken {
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly createdBy: string;
  readonly now: Date;
}

export interface NewDevice {
  readonly id: string;
  readonly name: string;
  readonly os: string;
  readonly agentVersion: string;
  readonly secretHash: string;
}

@Injectable()
export class DevicesRepository {
  public constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  public async createEnrollmentToken(input: NewEnrollmentToken): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const token = await tx.enrollmentToken.create({
        data: { userId: input.userId, tokenHash: input.tokenHash, expiresAt: input.expiresAt, createdBy: input.createdBy, createdAt: input.now },
        select: { id: true },
      });
      // The token value is never part of the audit summary; only its id and expiry.
      await writeAudit(tx, {
        occurredAt: input.now,
        actorId: input.createdBy,
        action: "device.enrollment_token_issued",
        targetType: "user",
        targetId: input.userId,
        summary: { tokenId: token.id, expiresAt: input.expiresAt.toISOString() },
      });
    });
  }

  /**
   * Consumes a valid token and creates the device atomically. The conditional UPDATE is the single-use guard:
   * two concurrent enrollments with one token cannot both match `usedAt IS NULL`.
   * Returns null for unknown, used or expired tokens (the caller does not distinguish them).
   */
  public async consumeTokenAndCreateDevice(tokenHash: string, device: NewDevice, now: Date): Promise<{ readonly deviceId: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.enrollmentToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return null;
      const token = await tx.enrollmentToken.findUniqueOrThrow({ where: { tokenHash }, select: { userId: true, user: { select: { status: true } } } });
      // A user disabled after the token was issued gets no device (the token stays spent).
      if (token.user.status !== "active") return null;
      await tx.device.create({
        data: { id: device.id, userId: token.userId, name: device.name, os: device.os, agentVersion: device.agentVersion, secretHash: device.secretHash, enrolledAt: now },
      });
      await writeAudit(tx, {
        occurredAt: now,
        actorId: token.userId,
        action: "device.enrolled",
        targetType: "device",
        targetId: device.id,
        summary: { name: device.name, os: device.os, agentVersion: device.agentVersion },
      });
      return { deviceId: device.id };
    });
  }

  public async findAuthRecord(id: string): Promise<DeviceAuthRecord | null> {
    const row = await this.prisma.device.findUnique({
      where: { id },
      select: { id: true, userId: true, secretHash: true, status: true, user: { select: { status: true } } },
    });
    if (!row) return null;
    return { id: row.id, userId: row.userId, secretHash: row.secretHash, status: row.status, ownerActive: row.user.status === "active" };
  }

  public findById(id: string): Promise<DeviceRecord | null> {
    return this.prisma.device.findUnique({ where: { id }, select: DEVICE_FIELDS });
  }

  public list(ownerId: string | null): Promise<DeviceRecord[]> {
    return this.prisma.device.findMany({ where: ownerId === null ? {} : { userId: ownerId }, orderBy: { enrolledAt: "desc" }, select: DEVICE_FIELDS });
  }

  /** Revokes an active device and audits it. Already-revoked devices are returned unchanged (idempotent, no second audit row). */
  public async revoke(id: string, actorId: string, now: Date): Promise<DeviceRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.device.findUnique({ where: { id }, select: DEVICE_FIELDS });
      if (!current) return null;
      if (current.status === "revoked") return current;
      const revoked = await tx.device.update({ where: { id }, data: { status: "revoked", revokedAt: now }, select: DEVICE_FIELDS });
      await writeAudit(tx, {
        occurredAt: now,
        actorId,
        action: "device.revoked",
        targetType: "device",
        targetId: id,
        summary: { name: current.name, ownerId: current.userId },
      });
      return revoked;
    });
  }

  public async recordHeartbeat(id: string, agentVersion: string, now: Date): Promise<void> {
    await this.prisma.device.update({ where: { id }, data: { lastSeenAt: now, agentVersion } });
  }
}
