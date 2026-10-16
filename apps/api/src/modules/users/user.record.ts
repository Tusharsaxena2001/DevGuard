import type { Role } from "@devguard/shared";

/** Internal shape returned by the users repository. Includes the password hash: it never leaves the API layers. */
export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: "active" | "disabled";
  readonly passwordHash: string;
  readonly createdAt: Date;
  readonly memberships: readonly { readonly role: Role; readonly projectId: string | null }[];
}
