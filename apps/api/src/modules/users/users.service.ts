import { Inject, Injectable } from "@nestjs/common";
import { ErrorCode, type CreateUserRequest, type UserSummary } from "@devguard/shared";
import type { UserPrincipal } from "../../common/auth/principals.js";
import { CLOCK, type Clock } from "../../common/clock/clock.js";
import { hashPassword } from "../../common/crypto/passwords.js";
import { ApiError } from "../../errors.js";
import type { UserRecord } from "./user.record.js";
import { toUserPrincipal, toUserSummary } from "./users.mapper.js";
import { UsersRepository } from "./users.repository.js";

@Injectable()
export class UsersService {
  public constructor(
    @Inject(UsersRepository) private readonly users: UsersRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** For login only: the record includes the password hash. Email is matched case-insensitively. */
  public findLoginRecord(email: string): Promise<UserRecord | null> {
    return this.users.findByEmail(email.trim().toLowerCase());
  }

  /** The principal for an active user, or null when missing or disabled (a disabled user's old session stops working). */
  public async findActivePrincipal(userId: string): Promise<UserPrincipal | null> {
    const record = await this.users.findById(userId);
    return record?.status === "active" ? toUserPrincipal(record) : null;
  }

  /** Is this user still active and a security admin? (Re-checked when an approval is used, not only when it was given.) */
  public async isActiveAdmin(userId: string): Promise<boolean> {
    return (await this.findActivePrincipal(userId))?.isAdmin === true;
  }

  /** Throws not_found for an unknown or disabled user (used before issuing an enrollment token). */
  public async requireActiveUser(userId: string): Promise<void> {
    if ((await this.findActivePrincipal(userId)) === null) throw new ApiError(ErrorCode.NotFound, "The requested resource was not found.");
  }

  /** Display names for a set of user ids (unknown ids are simply absent). */
  public async namesById(ids: readonly string[]): Promise<Map<string, string>> {
    return new Map((await this.users.findManyByIds(ids)).map((u) => [u.id, u.name]));
  }

  /** Where admin alerts go: active security admins only. */
  public adminEmails(): Promise<string[]> {
    return this.users.findActiveAdminEmails();
  }

  public async list(): Promise<UserSummary[]> {
    return (await this.users.list()).map(toUserSummary);
  }

  public async create(actor: UserPrincipal, request: CreateUserRequest): Promise<UserSummary> {
    const passwordHash = await hashPassword(request.password);
    const result = await this.users.create(
      { email: request.email.trim().toLowerCase(), name: request.name, passwordHash, isAdmin: request.isAdmin },
      actor.id,
      this.clock.now(),
    );
    if (!result.ok) throw new ApiError(ErrorCode.Conflict, "A user with this email already exists.");
    return toUserSummary(result.user);
  }
}
