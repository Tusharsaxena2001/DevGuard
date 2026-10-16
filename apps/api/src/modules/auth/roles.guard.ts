import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ErrorCode, type Role } from "@devguard/shared";
import { ROLES_KEY } from "../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../common/auth/principals.js";
import { ApiError } from "../../errors.js";

/**
 * Enforces `@Roles()` after authentication. Only global memberships count: project-scoped roles
 * (team lead / project owner scoping) are deliberately not evaluated in the MVP (ADR-014).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  public constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<readonly Role[] | undefined>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (required === undefined || required.length === 0) return true;
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    if (principal?.kind !== "user") throw new ApiError(ErrorCode.Forbidden, "You do not have permission to do this.");
    const allowed = principal.roles.some((r) => r.projectId === null && required.includes(r.role));
    if (!allowed) throw new ApiError(ErrorCode.Forbidden, "You do not have permission to do this.");
    return true;
  }
}
