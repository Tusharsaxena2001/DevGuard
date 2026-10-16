import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Role } from "@devguard/shared";
import { ErrorCode } from "@devguard/shared";
import { ApiError } from "../../errors.js";
import type { AuthenticatedRequest, DevicePrincipal, UserPrincipal } from "./principals.js";

export const PUBLIC_KEY = "devguard:public";
export const DEVICE_AUTH_KEY = "devguard:device-auth";
export const ROLES_KEY = "devguard:roles";
export const STRICT_THROTTLE_KEY = "devguard:strict-throttle";

/** No authentication. Everything else is denied by default. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);
/** Authenticated by device credential instead of a user session. */
export const DeviceAuth = (): MethodDecorator & ClassDecorator => SetMetadata(DEVICE_AUTH_KEY, true);
/** User must hold one of these roles globally (project-scoped roles are not evaluated in the MVP). */
export const Roles = (...roles: readonly Role[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
/** Applies the tighter auth throttle (login, enrollment). */
export const StrictThrottle = (): MethodDecorator & ClassDecorator => SetMetadata(STRICT_THROTTLE_KEY, true);

function principalOf(ctx: ExecutionContext): AuthenticatedRequest["principal"] {
  return ctx.switchToHttp().getRequest<AuthenticatedRequest>().principal;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): UserPrincipal => {
  const principal = principalOf(ctx);
  if (principal?.kind !== "user") throw new ApiError(ErrorCode.Unauthenticated, "Authentication is required.");
  return principal;
});

export const CurrentDevice = createParamDecorator((_data: unknown, ctx: ExecutionContext): DevicePrincipal => {
  const principal = principalOf(ctx);
  if (principal?.kind !== "device") throw new ApiError(ErrorCode.Unauthenticated, "Authentication is required.");
  return principal;
});
