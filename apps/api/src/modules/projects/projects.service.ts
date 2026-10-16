import { Inject, Injectable } from "@nestjs/common";
import { ErrorCode, type CreateProjectRequest, type ProjectSummary, type SetMembersRequest, type UpdateProjectRequest } from "@devguard/shared";
import type { UserPrincipal } from "../../common/auth/principals.js";
import { CLOCK, type Clock } from "../../common/clock/clock.js";
import { ApiError } from "../../errors.js";
import type { ProjectRecord } from "./project.record.js";
import { toProjectSummary } from "./projects.mapper.js";
import { ProjectsRepository } from "./projects.repository.js";

const notFound = (): ApiError => new ApiError(ErrorCode.NotFound, "The requested resource was not found.");
const nameTaken = (): ApiError => new ApiError(ErrorCode.Conflict, "A project with this name already exists.");

@Injectable()
export class ProjectsService {
  public constructor(
    @Inject(ProjectsRepository) private readonly projects: ProjectsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async list(): Promise<ProjectSummary[]> {
    return (await this.projects.list()).map(toProjectSummary);
  }

  public async get(id: string): Promise<ProjectSummary> {
    return toProjectSummary(await this.require(id));
  }

  /** For other modules: the project, or `not_found`. */
  public async require(id: string): Promise<ProjectRecord> {
    const project = await this.projects.findById(id);
    if (project === null) throw notFound();
    return project;
  }

  public async create(actor: UserPrincipal, request: CreateProjectRequest): Promise<ProjectSummary> {
    const result = await this.projects.create(request, actor.id, this.clock.now());
    if (!result.ok) throw nameTaken();
    return toProjectSummary(result.project);
  }

  public async update(actor: UserPrincipal, id: string, request: UpdateProjectRequest): Promise<ProjectSummary> {
    const result = await this.projects.update(id, request, actor.id, this.clock.now());
    if (!result.ok) throw result.reason === "not_found" ? notFound() : nameTaken();
    return toProjectSummary(result.project);
  }

  public async setMembers(actor: UserPrincipal, id: string, request: SetMembersRequest): Promise<ProjectSummary> {
    const result = await this.projects.setMembers(id, request.userIds, actor.id, this.clock.now());
    if (result.ok) return toProjectSummary(result.project);
    if (result.reason === "not_found") throw notFound();
    throw new ApiError(ErrorCode.ValidationFailed, "The request is invalid.", [{ path: "userIds", code: "unknown_or_disabled_user" }]);
  }

  /** Projects the user's devices receive at sync. */
  public listAssignedIds(userId: string): Promise<string[]> {
    return this.projects.listAssignedIds(userId);
  }

  public isAssigned(userId: string, projectId: string): Promise<boolean> {
    return this.projects.isAssigned(userId, projectId);
  }

  public findMany(ids: readonly string[]): Promise<ProjectRecord[]> {
    return this.projects.findManyByIds(ids);
  }
}
