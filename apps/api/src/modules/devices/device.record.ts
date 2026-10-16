export interface DeviceRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly os: string;
  readonly agentVersion: string;
  readonly status: "active" | "revoked";
  readonly enrolledAt: Date;
  readonly lastSeenAt: Date | null;
  readonly revokedAt: Date | null;
}

/** What device authentication needs: the stored secret hash, device status and whether the owner may still act. */
export interface DeviceAuthRecord {
  readonly id: string;
  readonly userId: string;
  readonly secretHash: string;
  readonly status: "active" | "revoked";
  readonly ownerActive: boolean;
}
