import type { SessionUser, UserSummary } from "@devguard/shared";
import type { UserPrincipal } from "../../common/auth/principals.js";
import type { UserRecord } from "./user.record.js";

export function isAdminRecord(record: Pick<UserRecord, "memberships">): boolean {
  return record.memberships.some((m) => m.role === "security_admin" && m.projectId === null);
}

export function toUserPrincipal(record: UserRecord): UserPrincipal {
  return {
    kind: "user",
    id: record.id,
    email: record.email,
    name: record.name,
    roles: record.memberships.map((m) => ({ role: m.role, projectId: m.projectId })),
    isAdmin: isAdminRecord(record),
  };
}

export function toSessionUser(principal: UserPrincipal): SessionUser {
  return { id: principal.id, email: principal.email, name: principal.name, roles: [...principal.roles], isAdmin: principal.isAdmin };
}

export function toUserSummary(record: UserRecord): UserSummary {
  return {
    id: record.id,
    email: record.email,
    name: record.name,
    status: record.status,
    isAdmin: isAdminRecord(record),
    createdAt: record.createdAt.toISOString(),
  };
}
