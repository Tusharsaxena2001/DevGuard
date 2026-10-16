import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";
import { DeviceStatusSchema } from "./enums.js";

export const CreateEnrollmentTokenRequestSchema = z.object({ userId: z.uuid() }).strict();
export type CreateEnrollmentTokenRequest = z.infer<typeof CreateEnrollmentTokenRequestSchema>;

/** The token is shown exactly once; the server keeps only its hash. */
export const EnrollmentTokenResponseSchema = z
  .object({ token: z.string().min(1), expiresAt: IsoDateTimeSchema })
  .strict();
export type EnrollmentTokenResponse = z.infer<typeof EnrollmentTokenResponseSchema>;

export const EnrollRequestSchema = z
  .object({
    token: z.string().min(1).max(256),
    deviceName: z.string().trim().min(1).max(200),
    os: z.string().trim().min(1).max(100),
    agentVersion: z.string().trim().min(1).max(50),
  })
  .strict();
export type EnrollRequest = z.infer<typeof EnrollRequestSchema>;

/** The secret is shown exactly once; the server keeps only its hash. */
export const EnrollResponseSchema = z
  .object({ deviceId: IdSchema, deviceSecret: z.string().min(1).max(512) })
  .strict();
export type EnrollResponse = z.infer<typeof EnrollResponseSchema>;

export const HeartbeatRequestSchema = z.object({ agentVersion: z.string().trim().min(1).max(50) }).strict();
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

/** Public view of a device: no secret, no hash. */
export const DeviceSummarySchema = z
  .object({
    id: IdSchema,
    userId: IdSchema,
    name: z.string(),
    os: z.string(),
    agentVersion: z.string(),
    status: DeviceStatusSchema,
    enrolledAt: IsoDateTimeSchema,
    lastSeenAt: IsoDateTimeSchema.nullable(),
    revokedAt: IsoDateTimeSchema.nullable(),
  })
  .strict();
export type DeviceSummary = z.infer<typeof DeviceSummarySchema>;

const DEVICE_CREDENTIAL_SEPARATOR = ".";

/** The bearer value a device presents: `<deviceId>.<secret>` (the id selects the row, the secret is compared by hash). */
export function formatDeviceCredential(deviceId: string, deviceSecret: string): string {
  return `${deviceId}${DEVICE_CREDENTIAL_SEPARATOR}${deviceSecret}`;
}

export type ParsedDeviceCredential = { readonly ok: true; readonly deviceId: string; readonly deviceSecret: string } | { readonly ok: false };

export function parseDeviceCredential(value: string): ParsedDeviceCredential {
  const at = value.indexOf(DEVICE_CREDENTIAL_SEPARATOR);
  if (at <= 0 || at === value.length - 1) return { ok: false };
  return { ok: true, deviceId: value.slice(0, at), deviceSecret: value.slice(at + 1) };
}
