import type { DeviceSummary } from "@devguard/shared";
import type { DeviceRecord } from "./device.record.js";

export function toDeviceSummary(record: DeviceRecord): DeviceSummary {
  return {
    id: record.id,
    userId: record.userId,
    name: record.name,
    os: record.os,
    agentVersion: record.agentVersion,
    status: record.status,
    enrolledAt: record.enrolledAt.toISOString(),
    lastSeenAt: record.lastSeenAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
  };
}
