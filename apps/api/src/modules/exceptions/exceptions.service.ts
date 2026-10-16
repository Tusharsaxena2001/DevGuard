import { Inject, Injectable } from "@nestjs/common";
import { validateException } from "@devguard/policy-engine";
import {
  ErrorCode,
  type ExceptionDecisionInput,
  type ExceptionEntry,
  type ExceptionPage,
  type ExceptionQuery,
  type ExceptionRejectionInput,
  type ExceptionRequestInput,
  type ExceptionStatus,
  type ExceptionValidationResult,
  type ValidException,
} from "@devguard/shared";
import type { DevicePrincipal, UserPrincipal } from "../../common/auth/principals.js";
import { CLOCK, type Clock } from "../../common/clock/clock.js";
import type { Env } from "../../config/env.js";
import { ENV } from "../../config/env.token.js";
import { ApiError } from "../../errors.js";
import { DestinationsService } from "../destinations/destinations.service.js";
import { EventsService } from "../events/events.service.js";
import { ProjectsService } from "../projects/projects.service.js";
import { UsersService } from "../users/users.service.js";
import { ExceptionsRepository, type DecisionRecord, type ExceptionRecord } from "./exceptions.repository.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = (): ApiError => new ApiError(ErrorCode.NotFound, "The requested resource was not found.");
const forbidden = (): ApiError => new ApiError(ErrorCode.Forbidden, "You do not have permission to do this.");
const invalid = (path: string, code: string): ApiError => new ApiError(ErrorCode.ValidationFailed, "The request is invalid.", [{ path, code }]);

/** Who is asking: a dashboard user, or a user's device. The exception always belongs to the person. */
export interface Requester {
  readonly userId: string;
  readonly deviceId: string | null;
}

/** The decision that currently governs an approved request: its latest approval. */
const latestApproval = (r: ExceptionRecord): DecisionRecord | undefined => [...r.decisions].reverse().find((d) => d.decision === "approved");

/** Expiry is evaluated on read and on validation, never by a background job. */
function effectiveStatus(r: ExceptionRecord, now: Date): ExceptionStatus {
  if (r.status !== "approved") return r.status;
  const approval = latestApproval(r);
  return approval?.expiresAt != null && approval.expiresAt.getTime() > now.getTime() ? "approved" : "expired";
}

@Injectable()
export class ExceptionsService {
  public constructor(
    @Inject(ExceptionsRepository) private readonly repo: ExceptionsRepository,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(DestinationsService) private readonly destinations: DestinationsService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * A developer (or their agent) asks for permission to push one project to one destination. The destination is
   * normalised and must parse; the requester must be assigned to the project; the linked event, if any, must be theirs.
   */
  public async request(requester: Requester, input: ExceptionRequestInput): Promise<ExceptionEntry> {
    if (!UUID.test(input.projectId)) throw invalid("projectId", "invalid_uuid");
    // Unknown and unassigned look the same, so project ids cannot be probed.
    if (!(await this.projects.isAssigned(requester.userId, input.projectId))) throw forbidden();
    const project = await this.projects.require(input.projectId);
    const destination = this.destinations.normalize(input.destination);
    if (input.eventId !== undefined && !(UUID.test(input.eventId) && (await this.events.isOwnedBy(input.eventId, requester.userId)))) throw invalid("eventId", "unknown_event");

    const result = await this.repo.create(
      { projectId: project.id, requesterId: requester.userId, deviceId: requester.deviceId, destHost: destination.host, destRepo: destination.repoPath, reason: input.reason, eventId: input.eventId ?? null },
      this.clock.now(),
    );
    if (!result.ok) {
      throw new ApiError(ErrorCode.Conflict, result.reason === "already_pending" ? "You already have a pending request for this destination." : "You have too many pending requests. Wait for a decision first.");
    }
    return this.entry(result.request);
  }

  /** Admins see every request; everyone else only their own. */
  public async list(scope: { readonly userId: string; readonly isAdmin: boolean }, query: ExceptionQuery): Promise<ExceptionPage> {
    const visibility = scope.isAdmin ? {} : { requesterId: scope.userId };
    const { items, total } = await this.repo.list(query, visibility, this.clock.now());
    return { items: await this.entries(items), total, page: query.page, pageSize: query.pageSize };
  }

  public async get(requesterScope: { readonly userId: string; readonly isAdmin: boolean }, id: string): Promise<ExceptionEntry> {
    const record = await this.repo.findById(id);
    // Someone else's request is "not found", so ids cannot be probed.
    if (record === null || (!requesterScope.isAdmin && record.requesterId !== requesterScope.userId)) throw notFound();
    return this.entry(record);
  }

  /** Approve a pending request. Approver != requester; the expiry must be in the future and within the server's cap. */
  public async approve(actor: UserPrincipal, id: string, input: ExceptionDecisionInput): Promise<ExceptionEntry> {
    const now = this.clock.now();
    const expiresAt = new Date(input.expiresAt);
    const latest = new Date(now.getTime() + this.env.EXCEPTION_MAX_TTL_HOURS * 3_600_000);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) throw invalid("expiresAt", "must_be_in_the_future");
    if (expiresAt.getTime() > latest.getTime()) throw invalid("expiresAt", "exceeds_maximum");
    return this.decide(actor, id, { kind: "approved", reason: input.reason, expiresAt }, now);
  }

  public reject(actor: UserPrincipal, id: string, input: ExceptionRejectionInput): Promise<ExceptionEntry> {
    return this.decide(actor, id, { kind: "rejected", reason: input.reason, expiresAt: null }, this.clock.now());
  }

  /** Withdraw an approval that is still in force. Takes effect at the next validation. */
  public revoke(actor: UserPrincipal, id: string, input: ExceptionRejectionInput): Promise<ExceptionEntry> {
    return this.decide(actor, id, { kind: "revoked", reason: input.reason, expiresAt: null }, this.clock.now());
  }

  /**
   * The agent asks: may this device's owner push this project to this destination right now? Answered from the
   * server's records and clock only; the client's claims are not an input. Unassigned owner, unparsable destination,
   * wrong scope, expired, revoked or self-approved all read as "not valid".
   */
  public async validate(device: DevicePrincipal, input: { projectId: string; destination: string }): Promise<ExceptionValidationResult> {
    const none: ExceptionValidationResult = { valid: false };
    if (!UUID.test(input.projectId)) return none;
    let destination;
    try {
      destination = this.destinations.normalize(input.destination);
    } catch {
      return none;
    }
    if (!(await this.projects.isAssigned(device.userId, input.projectId))) return none;
    const now = this.clock.now();
    const candidates = (await this.repo.approvedFor(device.userId, input.projectId, destination.host, destination.repoPath)).flatMap((record) => {
      const approval = latestApproval(record);
      if (approval === undefined || approval.expiresAt === null) return [];
      const exception: ValidException = {
        id: record.id,
        projectId: record.projectId,
        destination: { host: record.destHost, repoPath: record.destRepo },
        status: "approved",
        expiresAt: approval.expiresAt.toISOString(),
        approverId: approval.deciderId,
        requesterId: record.requesterId,
        waivedRuleIds: [],
      };
      return validateException(exception, { projectId: input.projectId, destination, now }).ok ? [exception] : [];
    });
    // The approver's authority is checked now, not only when they approved: a demoted or disabled admin's approvals stop working.
    const approverStillValid = new Map<string, boolean>(await Promise.all([...new Set(candidates.map((c) => c.approverId))].map(async (id) => [id, await this.users.isActiveAdmin(id)] as const)));
    const best = [...candidates.filter((c) => approverStillValid.get(c.approverId) === true)].sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt) || a.id.localeCompare(b.id))[0];
    if (best === undefined) return none;
    return { valid: true, exceptionId: best.id, expiresAt: best.expiresAt, approverId: best.approverId, requesterId: best.requesterId, waivedRuleIds: [] };
  }

  private async decide(actor: UserPrincipal, id: string, input: Parameters<ExceptionsRepository["decide"]>[2], now: Date): Promise<ExceptionEntry> {
    const result = await this.repo.decide(id, actor.id, input, now);
    if (result.ok) return this.entry(result.request);
    if (result.reason === "not_found") throw notFound();
    if (result.reason === "self_decision") throw new ApiError(ErrorCode.SelfApprovalForbidden, "You cannot approve your own request.");
    throw new ApiError(ErrorCode.Conflict, "The request is not in a state that allows this.");
  }

  private async entry(record: ExceptionRecord): Promise<ExceptionEntry> {
    const [entry] = await this.entries([record]);
    if (entry === undefined) throw notFound();
    return entry;
  }

  private async entries(records: readonly ExceptionRecord[]): Promise<ExceptionEntry[]> {
    const now = this.clock.now();
    const userIds = [...new Set(records.flatMap((r) => [r.requesterId, ...r.decisions.map((d) => d.deciderId)]))];
    const [names, projects] = await Promise.all([this.users.namesById(userIds), this.projects.findMany([...new Set(records.map((r) => r.projectId))])]);
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    return records.map((r) => {
      const status = effectiveStatus(r, now);
      return {
        id: r.id,
        projectId: r.projectId,
        projectName: projectNames.get(r.projectId) ?? "unknown",
        requesterId: r.requesterId,
        requesterName: names.get(r.requesterId) ?? "unknown",
        deviceId: r.deviceId,
        destination: { host: r.destHost, repoPath: r.destRepo },
        reason: r.reason,
        status,
        eventId: r.eventId,
        createdAt: r.createdAt.toISOString(),
        expiresAt: status === "approved" ? (latestApproval(r)?.expiresAt?.toISOString() ?? null) : null,
        decisions: r.decisions.map((d) => ({
          decision: d.decision,
          deciderId: d.deciderId,
          deciderName: names.get(d.deciderId) ?? "unknown",
          reason: d.reason,
          expiresAt: d.expiresAt?.toISOString() ?? null,
          decidedAt: d.decidedAt.toISOString(),
        })),
      };
    });
  }
}
