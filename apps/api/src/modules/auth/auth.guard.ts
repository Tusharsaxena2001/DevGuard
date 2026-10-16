import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ErrorCode } from "@devguard/shared";
import { DEVICE_AUTH_KEY, PUBLIC_KEY } from "../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../common/auth/principals.js";
import { readCookie } from "../../common/cookies.js";
import { ApiError } from "../../errors.js";
import { DevicesService } from "../devices/devices.service.js";
import { AuthService } from "./auth.service.js";
import { SESSION_COOKIE } from "./session-cookie.js";

const BEARER = /^Bearer (\S+)$/;

/**
 * Default deny. Every route needs a principal unless marked `@Public()`.
 * User routes accept only the session cookie; `@DeviceAuth()` routes accept only a device bearer credential.
 * The two never substitute for each other.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  public constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DevicesService) private readonly devices: DevicesService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_KEY, targets) === true) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (this.reflector.getAllAndOverride<boolean | undefined>(DEVICE_AUTH_KEY, targets) === true) {
      const bearer = BEARER.exec(request.headers.authorization ?? "")?.[1];
      if (bearer === undefined) throw new ApiError(ErrorCode.Unauthenticated, "Authentication is required.");
      request.principal = await this.devices.authenticateDevice(bearer);
      return true;
    }

    const session = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (session === undefined) throw new ApiError(ErrorCode.Unauthenticated, "Authentication is required.");
    request.principal = await this.auth.authenticateSession(session);
    return true;
  }
}
