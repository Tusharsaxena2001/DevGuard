import { Inject, Injectable } from "@nestjs/common";
import { ErrorCode, type FingerprintEntry, type RepoRegistrationEntry, type ReportFingerprintRequest } from "@devguard/shared";
import type { DevicePrincipal, UserPrincipal } from "../../common/auth/principals.js";
import { CLOCK, type Clock } from "../../common/clock/clock.js";
import { ApiError } from "../../errors.js";
import { DestinationsService } from "../destinations/destinations.service.js";
import { ProjectsService } from "../projects/projects.service.js";
import { FingerprintsRepository, type FingerprintRecord } from "./fingerprints.repository.js";

const notFound = (): ApiError => new ApiError(ErrorCode.NotFound, "The requested resource was not found.");
const forbidden = (): ApiError => new ApiError(ErrorCode.Forbidden, "You do not have permission to do this.");

const limitReached = (): ApiError => new ApiError(ErrorCode.Conflict, "This project has reached its fingerprint limit. An administrator must remove unused ones.");

const toEntry = (r: FingerprintRecord): FingerprintEntry => ({
  id: r.id,
  fingerprint: r.fingerprint as FingerprintEntry["fingerprint"],
  source: r.source,
  reportedByDeviceId: r.reportedByDeviceId,
  createdAt: r.createdAt.toISOString(),
});

@Injectable()
export class FingerprintsService {
  public constructor(
    @Inject(FingerprintsRepository) private readonly repo: FingerprintsRepository,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(DestinationsService) private readonly destinations: DestinationsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async list(projectId: string): Promise<FingerprintEntry[]> {
    await this.projects.require(projectId);
    return (await this.repo.list([projectId])).map(toEntry);
  }

  public async addManual(actor: UserPrincipal, projectId: string, fingerprint: string): Promise<FingerprintEntry> {
    await this.projects.require(projectId);
    const result = await this.repo.addManual(projectId, fingerprint, actor.id, this.clock.now());
    if (!result.ok) throw result.reason === "limit" ? limitReached() : new ApiError(ErrorCode.Conflict, "This entry already exists for the project.");
    return toEntry(result.row);
  }

  public async remove(actor: UserPrincipal, projectId: string, id: string): Promise<void> {
    if (!(await this.repo.remove(projectId, id, actor.id, this.clock.now()))) throw notFound();
  }

  /**
   * A device says "my repo with this remote has this root commit" (ADR-008). Accepted only when the device's owner is
   * assigned to the project AND the remote is one of the project's canonical repos or approved destinations. A bogus
   * report can only make the reporter's own repo count as that project, which is stricter, not looser.
   */
  public async report(device: DevicePrincipal, request: ReportFingerprintRequest): Promise<void> {
    await this.requireAssigned(device, request.projectId);
    const remote = this.destinations.normalize(request.remote);
    if (!(await this.destinations.belongsToProject(request.projectId, remote))) throw forbidden();
    const added = await this.repo.addFromDevice(request.projectId, request.fingerprint, device.deviceId, device.userId, this.clock.now());
    if (added === "limit") throw limitReached();
  }

  /** Fallback registration of the repo a device is in (ADR-003/008). */
  public async register(device: DevicePrincipal, projectId: string, fingerprint: string): Promise<void> {
    await this.requireAssigned(device, projectId);
    await this.repo.register(projectId, device.deviceId, device.userId, fingerprint, this.clock.now());
  }

  public async listRegistrations(projectId: string): Promise<RepoRegistrationEntry[]> {
    await this.projects.require(projectId);
    return (await this.repo.listRegistrations(projectId)).map((r) => ({
      id: r.id,
      deviceId: r.deviceId,
      deviceName: r.deviceName,
      fingerprint: r.fingerprint as RepoRegistrationEntry["fingerprint"],
      registeredAt: r.registeredAt.toISOString(),
    }));
  }

  /** Fingerprint values per project, for sync. */
  public async valuesForProjects(projectIds: readonly string[]): Promise<Map<string, string[]>> {
    const rows = await this.repo.list(projectIds);
    return new Map(projectIds.map((id) => [id, rows.filter((r) => r.projectId === id).map((r) => r.fingerprint)]));
  }

  private async requireAssigned(device: DevicePrincipal, projectId: string): Promise<void> {
    // Unassigned or unknown project: the same answer, so project ids cannot be probed.
    if (!(await this.projects.isAssigned(device.userId, projectId))) throw forbidden();
  }
}
