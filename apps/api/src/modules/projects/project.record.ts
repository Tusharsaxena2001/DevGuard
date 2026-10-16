import type { Classification } from "@devguard/shared";

export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly classification: Classification;
  readonly ownerId: string;
  readonly createdAt: Date;
  /** Employees assigned to the project (they receive it at sync). */
  readonly memberIds: readonly string[];
}
