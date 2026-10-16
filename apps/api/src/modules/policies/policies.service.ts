import { Inject, Injectable } from "@nestjs/common";
import { SECRET_RULES } from "@devguard/policy-engine";
import { ErrorCode, type PolicyUpdateRequest, type PolicyVersionEntry, type ProjectPolicy } from "@devguard/shared";
import type { UserPrincipal } from "../../common/auth/principals.js";
import { CLOCK, type Clock } from "../../common/clock/clock.js";
import { ApiError } from "../../errors.js";
import { DestinationsService } from "../destinations/destinations.service.js";
import { ProjectsService } from "../projects/projects.service.js";
import { PoliciesRepository, type PolicyVersionRecord } from "./policies.repository.js";

const KNOWN_SECRET_RULES: ReadonlySet<string> = new Set(SECRET_RULES.map((r) => r.id));

const toEntry = (v: PolicyVersionRecord): PolicyVersionEntry => ({
  version: v.version,
  mode: v.mode,
  prohibitedGlobs: [...v.prohibitedGlobs],
  secretRules: [...v.secretRules],
  createdBy: v.createdBy,
  createdAt: v.createdAt.toISOString(),
});

@Injectable()
export class PoliciesService {
  public constructor(
    @Inject(PoliciesRepository) private readonly repo: PoliciesRepository,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(DestinationsService) private readonly destinations: DestinationsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async getPolicy(projectId: string): Promise<ProjectPolicy> {
    await this.projects.require(projectId);
    const policy = (await this.policiesFor([projectId])).get(projectId);
    if (policy === undefined) throw new ApiError(ErrorCode.PolicyUnavailable, "Policy is temporarily unavailable.");
    return policy;
  }

  public async listVersions(projectId: string): Promise<PolicyVersionEntry[]> {
    await this.projects.require(projectId);
    return (await this.repo.versions(projectId)).map(toEntry);
  }

  public async update(actor: UserPrincipal, projectId: string, request: PolicyUpdateRequest): Promise<ProjectPolicy> {
    await this.projects.require(projectId);
    const unknown = request.secretRules.filter((id) => !KNOWN_SECRET_RULES.has(id));
    if (unknown.length > 0) throw new ApiError(ErrorCode.ValidationFailed, "The request is invalid.", [{ path: "secretRules", code: "unknown_rule" }]);

    const result = await this.repo.createVersion(projectId, request, actor.id, this.clock.now());
    if (!result.ok) {
      if (result.reason === "conflict") throw new ApiError(ErrorCode.Conflict, `The policy changed since version ${request.baseVersion} (now ${result.currentVersion}). Reload and try again.`);
      throw new ApiError(ErrorCode.NotFound, "The requested resource was not found.");
    }
    return this.getPolicy(projectId);
  }

  /**
   * Current policy of each project, in the shape agents cache: versioned settings plus the project's classification and
   * approved destinations. Canonical repos are implicitly approved, so they are listed as exact destinations too.
   */
  public async policiesFor(projectIds: readonly string[]): Promise<Map<string, ProjectPolicy>> {
    const [versions, projects, grouped] = await Promise.all([this.repo.currentFor(projectIds), this.projects.findMany(projectIds), this.destinations.forProjects(projectIds)]);
    const result = new Map<string, ProjectPolicy>();
    for (const project of projects) {
      const version = versions.find((v) => v.projectId === project.id);
      if (version === undefined) continue; // a project without a policy version is not synced (fail closed on the agent)
      const parts = grouped.get(project.id);
      const seen = new Set<string>();
      const destinations: ProjectPolicy["destinations"] = [
        ...(parts?.destinations ?? []).map((d) => ({ id: d.id, host: d.host, repoPath: d.repoPath, type: d.type })),
        ...(parts?.canonicalRepos ?? []).map((c) => ({ host: c.host, repoPath: c.repoPath, type: "exact" as const })),
      ].filter((d) => {
        const key = `${d.type}|${d.host}|${d.repoPath}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      result.set(project.id, {
        version: version.version,
        mode: version.mode,
        classification: project.classification,
        destinations,
        prohibitedGlobs: [...version.prohibitedGlobs],
        secretRules: [...version.secretRules],
      });
    }
    return result;
  }
}
