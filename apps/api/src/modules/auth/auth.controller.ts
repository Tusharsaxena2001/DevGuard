import { Body, Controller, Get, HttpCode, Inject, Post, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { LoginRequestSchema, type LoginRequest, type SessionUser } from "@devguard/shared";
import { API_V1 } from "../../common/api-version.js";
import { CurrentUser, Public, StrictThrottle } from "../../common/auth/decorators.js";
import type { UserPrincipal } from "../../common/auth/principals.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { Env } from "../../config/env.js";
import { ENV } from "../../config/env.token.js";
import { toSessionUser } from "../users/users.mapper.js";
import { AuthService } from "./auth.service.js";
import { SESSION_COOKIE } from "./session-cookie.js";

@ApiTags("auth")
@Controller(`${API_V1}/auth`)
export class AuthController {
  public constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private cookieOptions(): { httpOnly: true; sameSite: "lax"; secure: boolean; path: string } {
    // SameSite=Lax keeps the cookie off cross-site POSTs (CSRF); CORS is limited to the dashboard origin.
    return { httpOnly: true, sameSite: "lax", secure: this.env.NODE_ENV === "production", path: "/" };
  }

  @Post("login")
  @Public()
  @StrictThrottle()
  @HttpCode(200)
  @ApiOperation({ summary: "Sign in with email and password; sets an httpOnly session cookie" })
  public async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionUser> {
    const result = await this.auth.login(body);
    res.cookie(SESSION_COOKIE, result.token, { ...this.cookieOptions(), maxAge: result.maxAgeSeconds * 1000 });
    return toSessionUser(result.user);
  }

  @Post("logout")
  @Public()
  @HttpCode(204)
  @ApiOperation({ summary: "Clear the session cookie" })
  public logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  @Get("me")
  @ApiOperation({ summary: "The signed-in user" })
  public me(@CurrentUser() user: UserPrincipal): SessionUser {
    return toSessionUser(user);
  }
}
