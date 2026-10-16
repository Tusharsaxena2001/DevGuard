import { Inject, Injectable } from "@nestjs/common";
import { ErrorCode, type EventBatchResult, type EventPage, type EventQuery, type EventResult, type SecurityEventBatch, type SecurityEventEntry } from "@devguard/shared";
import type { DevicePrincipal, UserPrincipal } from "../../common/auth/principals.js";
import { CLOCK, type Clock } from "../../common/clock/clock.js";
import { ApiError } from "../../errors.js";
import { ProjectsService } from "../projects/projects.service.js";
import { UsersService } from "../users/users.service.js";
import { toEventEntry } from "./events.mapper.js";
import { EventsRepository, type EventRecord } from "./events.repository.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class EventsService {
  public constructor(
    @Inject(EventsRepository) private readonly repo: EventsRepository,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Stores a batch from a device. The device and its owner come from the credential, never from the body. An event for a
   * project the owner is not assigned to (or an id that is not a UUID) is `rejected` (final, not stored); a key this device already delivered is
   * `duplicate` (no-op); everything else is `accepted`. The body is strict, so no content field can get this far.
   */
  public async ingest(device: DevicePrincipal, batch: SecurityEventBatch): Promise<EventBatchResult> {
    const assigned = new Map<string, boolean>();
    const isAssigned = async (projectId: string): Promise<boolean> => {
      const known = assigned.get(projectId);
      if (known !== undefined) return known;
      const result = await this.projects.isAssigned(device.userId, projectId);
      assigned.set(projectId, result);
      return result;
    };

    const existing = await this.repo.existingKeys(device.deviceId, batch.events.map((e) => e.idempotencyKey));
    const results: EventResult[] = [];
    const toStore = [];
    const seenInBatch = new Set<string>();
    for (const event of batch.events) {
      if (existing.has(event.idempotencyKey) || seenInBatch.has(event.idempotencyKey)) {
        results.push({ idempotencyKey: event.idempotencyKey, status: "duplicate" });
      } else if (!hasValidIds(event) || (event.projectId !== null && !(await isAssigned(event.projectId)))) {
        results.push({ idempotencyKey: event.idempotencyKey, status: "rejected" });
      } else {
        seenInBatch.add(event.idempotencyKey);
        toStore.push(event);
        results.push({ idempotencyKey: event.idempotencyKey, status: "accepted" });
      }
    }
    if (toStore.length > 0) await this.repo.insert(device.deviceId, device.userId, toStore, this.clock.now());
    return { results };
  }

  /** The latest events with this outcome across all users (for the admin dashboard). */
  public async recent(outcome: EventQuery["outcome"], limit: number): Promise<SecurityEventEntry[]> {
    const { items } = await this.repo.list({ outcome, page: 1, pageSize: limit }, {});
    return this.entries(items);
  }

  /** Is this event the user's own? (Used to check the event an exception request points at.) */
  public isOwnedBy(eventId: string, userId: string): Promise<boolean> {
    return this.repo.isOwnedBy(eventId, userId);
  }

  /** Admins see every event; everyone else only their own. */
  public async list(actor: UserPrincipal, query: EventQuery): Promise<EventPage> {
    const { items, total } = await this.repo.list(query, scopeOf(actor));
    return { items: await this.entries(items), total, page: query.page, pageSize: query.pageSize };
  }

  /** Someone else's event is reported as not found, so ids cannot be probed. */
  public async get(actor: UserPrincipal, id: string): Promise<SecurityEventEntry> {
    const record = await this.repo.findById(id, scopeOf(actor));
    if (record === null) throw new ApiError(ErrorCode.NotFound, "The requested resource was not found.");
    const [entry] = await this.entries([record]);
    if (entry === undefined) throw new ApiError(ErrorCode.NotFound, "The requested resource was not found.");
    return entry;
  }

  private async entries(records: readonly EventRecord[]): Promise<SecurityEventEntry[]> {
    const names = await this.users.namesById([...new Set(records.map((r) => r.userId))]);
    return records.map((r) => toEventEntry(r, names.get(r.userId) ?? "unknown"));
  }
}

/** The columns are UUIDs; anything else cannot be stored, so it is a final rejection, not an error for the whole batch. */
const hasValidIds = (event: { projectId: string | null; exceptionId?: string | undefined }): boolean =>
  (event.projectId === null || UUID.test(event.projectId)) && (event.exceptionId === undefined || UUID.test(event.exceptionId));

const scopeOf = (actor: UserPrincipal): { userId?: string } => (actor.isAdmin ? {} : { userId: actor.id });
