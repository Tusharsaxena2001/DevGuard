import { Inject, Injectable } from "@nestjs/common";
import { jwtVerify, SignJWT } from "jose";
import { ErrorCode, type LoginRequest } from "@devguard/shared";
import type { UserPrincipal } from "../../common/auth/principals.js";
import { CLOCK, type Clock } from "../../common/clock/clock.js";
import { hashPassword, verifyPassword } from "../../common/crypto/passwords.js";
import type { Env } from "../../config/env.js";
import { ENV } from "../../config/env.token.js";
import { ApiError } from "../../errors.js";
import { toUserPrincipal } from "../users/users.mapper.js";
import { UsersService } from "../users/users.service.js";

const ALG = "HS256";
const LOGIN_FAILED = "Invalid email or password.";

export interface LoginResult {
  readonly token: string;
  readonly maxAgeSeconds: number;
  readonly user: UserPrincipal;
}

@Injectable()
export class AuthService {
  private readonly key: Uint8Array;
  /** Verified against when the email is unknown, so "no such user" costs as much as "wrong password". */
  private readonly decoyHash: Promise<string> = hashPassword("decoy-password-never-matches");

  public constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.key = new TextEncoder().encode(env.JWT_SECRET);
  }

  /** One generic failure for unknown email, wrong password and disabled account. */
  public async login(request: LoginRequest): Promise<LoginResult> {
    const record = await this.users.findLoginRecord(request.email);
    // Anything that is not a real argon2 hash (unknown user, seed placeholder) is verified against the decoy instead,
    // so those cases cost the same as a wrong password.
    const stored = record?.passwordHash.startsWith("$argon2") === true ? record.passwordHash : await this.decoyHash;
    const passwordOk = (await verifyPassword(stored, request.password)) && record !== null && stored === record.passwordHash;
    if (record === null || !passwordOk || record.status !== "active") throw new ApiError(ErrorCode.Unauthenticated, LOGIN_FAILED);

    const now = this.clock.now();
    const maxAgeSeconds = this.env.SESSION_TTL_MINUTES * 60;
    const issuedAt = Math.floor(now.getTime() / 1000);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: ALG })
      .setSubject(record.id)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + maxAgeSeconds)
      .sign(this.key);
    return { token, maxAgeSeconds, user: toUserPrincipal(record) };
  }

  /**
   * Resolves a session token to the current user. Status and roles are re-read on every request,
   * so disabling a user or changing roles takes effect immediately even for unexpired tokens.
   */
  public async authenticateSession(token: string): Promise<UserPrincipal> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: [ALG], currentDate: this.clock.now() });
      const principal = payload.sub === undefined ? null : await this.users.findActivePrincipal(payload.sub);
      if (principal !== null) return principal;
    } catch {
      // Bad signature, expired, malformed or not-a-uuid subject: all the same answer.
    }
    throw new ApiError(ErrorCode.Unauthenticated, "Authentication is required.");
  }
}
