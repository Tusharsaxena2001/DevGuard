import { Inject, Injectable } from "@nestjs/common";
import { isApproved, normalizeDestination } from "@devguard/policy-engine";
import { ErrorCode, type CanonicalRepoEntry, type DestinationEntry, type NormalizedDestination } from "@devguard/shared";
import type { UserPrincipal } from "../../common/auth/principals.js";
import { CLOCK, type Clock } from "../../common/clock/clock.js";
import { ApiError } from "../../errors.js";
import { ProjectsService } from "../projects/projects.service.js";
import { DestinationsRepository, type CanonicalRepoRecord, type DestinationRecord } from "./destinations.repository.js";

const notFound = (): ApiError => new ApiError(ErrorCode.NotFound, "The requested resource was not found.");
const duplicate = (): ApiError => new ApiError(ErrorCode.Conflict, "This entry already exists for the project.");

const toDestinationEntry = (r: DestinationRecord): DestinationEntry => ({ id: r.id, host: r.host, repoPath: r.repoPath, type: r.type, createdAt: r.createdAt.toISOString() });
const toCanonicalEntry = (r: CanonicalRepoRecord): CanonicalRepoEntry => ({ id: r.id, host: r.host, repoPath: r.repoPath, createdAt: r.createdAt.toISOString() });

export interface ProjectDestinations {
  readonly destinations: readonly DestinationRecord[];
  readonly canonicalRepos: readonly CanonicalRepoRecord[];
}

@Injectable()
export class DestinationsService {
  public constructor(
    @Inject(DestinationsRepository) private readonly repo: DestinationsRepository,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Canonicalises the typed remote with the policy engine; anything unusual is a 400 that names only the reason. */
  public normalize(raw: string): NormalizedDestination {
    const result = normalizeDestination(raw);
    if (!result.ok) throw new ApiError(ErrorCode.ValidationFailed, "The request is invalid.", [{ path: "url", code: result.reason }]);
    return result.value;
  }

  public async listDestinations(projectId: string): Promise<DestinationEntry[]> {
    await this.projects.require(projectId);
    return (await this.repo.listDestinations([projectId])).map(toDestinationEntry);
  }

  public async addDestination(actor: UserPrincipal, projectId: string, url: string): Promise<DestinationEntry> {
    await this.projects.require(projectId);
    const result = await this.repo.addDestination(projectId, this.normalize(url), actor.id, this.clock.now());
    if (!result.ok) throw duplicate();
    return toDestinationEntry(result.entry);
  }

  public async removeDestination(actor: UserPrincipal, projectId: string, id: string): Promise<void> {
    if (!(await this.repo.removeDestination(projectId, id, actor.id, this.clock.now()))) throw notFound();
  }

  public async listCanonicalRepos(projectId: string): Promise<CanonicalRepoEntry[]> {
    await this.projects.require(projectId);
    return (await this.repo.listCanonicalRepos([projectId])).map(toCanonicalEntry);
  }

  public async addCanonicalRepo(actor: UserPrincipal, projectId: string, url: string): Promise<CanonicalRepoEntry> {
    await this.projects.require(projectId);
    const result = await this.repo.addCanonicalRepo(projectId, this.normalize(url), actor.id, this.clock.now());
    if (!result.ok) throw duplicate();
    return toCanonicalEntry(result.entry);
  }

  public async removeCanonicalRepo(actor: UserPrincipal, projectId: string, id: string): Promise<void> {
    if (!(await this.repo.removeCanonicalRepo(projectId, id, actor.id, this.clock.now()))) throw notFound();
  }

  /** Destinations and canonical repos for several projects, grouped by project (for sync). */
  public async forProjects(projectIds: readonly string[]): Promise<Map<string, ProjectDestinations>> {
    const [destinations, canonicalRepos] = await Promise.all([this.repo.listDestinations(projectIds), this.repo.listCanonicalRepos(projectIds)]);
    return new Map(
      projectIds.map((id) => [id, { destinations: destinations.filter((d) => d.projectId === id), canonicalRepos: canonicalRepos.filter((c) => c.projectId === id) }]),
    );
  }

  /** Does this remote belong to the project? Canonical repos count as approved destinations (exact host + path). */
  public async belongsToProject(projectId: string, remote: NormalizedDestination): Promise<boolean> {
    const { destinations, canonicalRepos } = (await this.forProjects([projectId])).get(projectId) ?? { destinations: [], canonicalRepos: [] };
    const allowlist = [
      ...destinations.map((d) => ({ host: d.host, repoPath: d.repoPath, type: d.type })),
      ...canonicalRepos.map((c) => ({ host: c.host, repoPath: c.repoPath, type: "exact" as const })),
    ];
    return isApproved(remote, allowlist).approved;
  }
}
