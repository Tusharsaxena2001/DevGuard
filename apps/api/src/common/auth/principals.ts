import type { Request } from "express";
import type { RoleAssignment } from "@devguard/shared";

/** A signed-in dashboard user. Only user routes accept this. */
export interface UserPrincipal {
  readonly kind: "user";
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly roles: readonly RoleAssignment[];
  readonly isAdmin: boolean;
}

/** An enrolled device. Only device routes accept this; it can never act as a user. */
export interface DevicePrincipal {
  readonly kind: "device";
  readonly deviceId: string;
  readonly userId: string;
}

export type Principal = UserPrincipal | DevicePrincipal;

export interface AuthenticatedRequest extends Request {
  principal?: Principal;
}
