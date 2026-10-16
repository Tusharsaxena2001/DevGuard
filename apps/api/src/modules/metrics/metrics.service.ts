import { Inject, Injectable } from "@nestjs/common";
import { OutcomeSchema, type MetricsQuery, type MetricsSummary } from "@devguard/shared";
import { CLOCK, type Clock } from "../../common/clock/clock.js";
import { EventsService } from "../events/events.service.js";
import { MetricsRepository } from "./metrics.repository.js";

const RANGE_MS = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 } as const;
/** An enrolled device that has not been heard from for this long counts as stale. */
const STALE_AFTER_MS = 24 * 3_600_000;
const RECENT_INCIDENTS = 10;

@Injectable()
export class MetricsService {
  public constructor(
    @Inject(MetricsRepository) private readonly repo: MetricsRepository,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async summary(query: MetricsQuery): Promise<MetricsSummary> {
    const now = this.clock.now();
    const since = new Date(now.getTime() - RANGE_MS[query.range]);
    const [data, recentIncidents] = await Promise.all([
      this.repo.collect(since, now, new Date(now.getTime() - STALE_AFTER_MS)),
      // An incident is a blocked push; the list shows the latest ones whatever the range.
      this.events.recent("blocked", RECENT_INCIDENTS),
    ]);
    const outcomes = Object.fromEntries(OutcomeSchema.options.map((o) => [o, data.outcomes.get(o) ?? 0])) as MetricsSummary["outcomes"];
    return {
      range: query.range,
      since: since.toISOString(),
      generatedAt: now.toISOString(),
      outcomes,
      totalEvents: Object.values(outcomes).reduce((a, b) => a + b, 0),
      topRules: [...data.topRules],
      blockedPerDay: [...data.blockedPerDay],
      exceptions: { pending: data.pendingExceptions, inForce: data.exceptionsInForce },
      devices: data.devices,
      recentIncidents,
    };
  }
}
