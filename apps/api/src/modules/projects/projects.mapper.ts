import type { ProjectSummary } from "@devguard/shared";
import type { ProjectRecord } from "./project.record.js";

export function toProjectSummary(record: ProjectRecord): ProjectSummary {
  return {
    id: record.id,
    name: record.name,
    classification: record.classification,
    ownerId: record.ownerId,
    createdAt: record.createdAt.toISOString(),
    memberIds: [...record.memberIds],
  };
}
