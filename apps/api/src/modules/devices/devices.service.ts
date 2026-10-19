import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  ErrorCode,
  parseDeviceCredential,
  type CreateEnrollmentTokenRequest,
  type DeviceSummary,
  type EnrollRequest,
  type EnrollResponse,
  type EnrollmentTokenResponse,
  type HeartbeatRequest,
} from "@devguard/shared";
import type { DevicePrincipal, UserPrincipal } from "../../common/auth/principals.js";
import { CLOCK, type Clock } from "../../common/clock/clock.js";
import { constantTimeEquals, generateSecret, sha256Hex } from "../../common/crypto/tokens.js";
import type { Env } from "../../config/env.js";
import { ENV } from "../../config/env.token.js";
import { ApiError } from "../../errors.js";
import { UsersService } from "../users/users.service.js";
import { toDeviceSummary } from "./devices.mapper.js";
import { DevicesRepository } from "./devices.repository.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Compared against when the device id is unknown, so lookups of real and fake ids cost the same. */
const DECOY_HASH = sha256Hex("decoy");

const unauthenticated = (): ApiError => new ApiError(ErrorCode.Unauthenticated, "Authentication is required.");
const notFound = (): ApiError => new ApiError(ErrorCode.NotFound, "The requested resource was not found.");

@Injectable()
export class DevicesService {
  public constructor(
    @Inject(DevicesRepository) private readonly devices: DevicesRepository,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Admin issues a one-time token for an employee. The raw token is returned once and only its hash is stored. */
  public async issueEnrollmentToken(actor: UserPrincipal, request: CreateEnrollmentTokenRequest): Promise<EnrollmentTokenResponse> {
    await this.users.requireActiveUser(request.userId);
    const now = this.clock.now();
    const token = generateSecret("dgt");
    const expiresAt = new Date(now.getTime() + this.env.ENROLLMENT_TOKEN_TTL_MINUTES * 60_000);
    await this.devices.createEnrollmentToken({ userId: request.userId, tokenHash: sha256Hex(token), expiresAt, createdBy: actor.id, now });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /** Public. Unknown, used and expired tokens are indistinguishable to the caller. */
  public async enroll(request: EnrollRequest): Promise<EnrollResponse> {
    const deviceId = randomUUID();
    const deviceSecret = generateSecret("dgs");
    const created = await this.devices.consumeTokenAndCreateDevice(
      sha256Hex(request.token),
      { id: deviceId, name: request.deviceName, os: request.os, agentVersion: request.agentVersion, secretHash: sha256Hex(deviceSecret) },
      this.clock.now(),
    );
    if (created === null) throw new ApiError(ErrorCode.EnrollmentTokenInvalid, "The enrollment token is invalid or expired.");
    return { deviceId, deviceSecret };
  }

  /**
   * Resolves the bearer credential `<deviceId>.<secret>` to a device principal.
   * Wrong secret and unknown device both answer 401; `device_revoked` is only revealed to someone holding the right secret.
   */
  public async authenticateDevice(credential: string): Promise<DevicePrincipal> {
    const parsed = parseDeviceCredential(credential);
    if (!parsed.ok || !UUID.test(parsed.deviceId)) throw unauthenticated();
    const record = await this.devices.findAuthRecord(parsed.deviceId);
    const secretMatches = constantTimeEquals(sha256Hex(parsed.deviceSecret), record?.secretHash ?? DECOY_HASH);
    if (record === null || !secretMatches) throw unauthenticated();
    if (record.status === "revoked") throw new ApiError(ErrorCode.DeviceRevoked, "This device has been revoked.");
    if (!record.ownerActive) throw unauthenticated();
    return { kind: "device", deviceId: record.id, userId: record.userId };
  }

  /** Admins see every device; everyone else only their own. */
  public async list(actor: UserPrincipal): Promise<DeviceSummary[]> {
    return (await this.devices.list(actor.isAdmin ? null : actor.id)).map(toDeviceSummary);
  }

  /** Someone else's device is reported as not found, not forbidden, so ids cannot be probed. */
  public async get(actor: UserPrincipal, id: string): Promise<DeviceSummary> {
    const record = await this.devices.findById(id);
    if (record === null || (!actor.isAdmin && record.userId !== actor.id)) throw notFound();
    return toDeviceSummary(record);
  }

  /** Display name of a device, or null when unknown (no actor check: for server-side use such as alert emails). */
  public async nameById(id: string): Promise<string | null> {
    return (await this.devices.findById(id))?.name ?? null;
  }

  public async revoke(actor: UserPrincipal, id: string): Promise<DeviceSummary> {
    const record = await this.devices.revoke(id, actor.id, this.clock.now());
    if (record === null) throw notFound();
    return toDeviceSummary(record);
  }

  public async heartbeat(device: DevicePrincipal, request: HeartbeatRequest): Promise<void> {
    await this.devices.recordHeartbeat(device.deviceId, request.agentVersion, this.clock.now());
  }
}
