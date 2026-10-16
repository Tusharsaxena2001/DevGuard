import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { AgentProject, AgentProjectSync, GitSha, ReportFingerprintRequest } from "@devguard/shared";
import type { DevicePrincipal } from "../../common/auth/principals.js";
import { CLOCK, type Clock } from "../../common/clock/clock.js";
import { DestinationsService } from "../destinations/destinations.service.js";
import { FingerprintsService } from "../fingerprints/fingerprints.service.js";
import { PoliciesService } from "../policies/policies.service.js";
import { ProjectsService } from "../projects/projects.service.js";

export interface ProjectSync {
  readonly body: AgentProjectSync;
  /** Hash of the projects only (not `syncedAt`), so an unchanged policy keeps the same ETag. */
  readonly etag: string;
}

@Injectable()
export class AgentService {
  public constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(PoliciesService) private readonly policies: PoliciesService,
    @Inject(DestinationsService) private readonly destinations: DestinationsService,
    @Inject(FingerprintsService) private readonly fingerprints: FingerprintsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Every project assigned to the device's owner, with everything an agent needs to enforce it (ADR-008). */
  public async syncProjects(device: DevicePrincipal): Promise<ProjectSync> {
    const ids = await this.projects.listAssignedIds(device.userId);
    const [records, policies, parts, fingerprints] = await Promise.all([
      this.projects.findMany(ids),
      this.policies.policiesFor(ids),
      this.destinations.forProjects(ids),
      this.fingerprints.valuesForProjects(ids),
    ]);
    const projects: AgentProject[] = records.flatMap((record) => {
      const policy = policies.get(record.id);
      if (policy === undefined) return [];
      return [
        {
          projectId: record.id,
          name: record.name,
          policy,
          canonicalRepos: (parts.get(record.id)?.canonicalRepos ?? []).map((c) => ({ host: c.host, repoPath: c.repoPath })),
          fingerprints: (fingerprints.get(record.id) ?? []) as GitSha[],
        },
      ];
    });
    const etag = `"${createHash("sha256").update(JSON.stringify(projects)).digest("hex").slice(0, 32)}"`;
    return { body: { projects, syncedAt: this.clock.now().toISOString() }, etag };
  }

  public reportFingerprint(device: DevicePrincipal, request: ReportFingerprintRequest): Promise<void> {
    return this.fingerprints.report(device, request);
  }
}
