import { useQuery } from "@tanstack/react-query";
import { EventPageSchema, type EventQuery } from "@devguard/shared";
import { useApi } from "../../../shared/api/api-context.js";

export type EventFilters = Partial<Pick<EventQuery, "outcome" | "ruleId" | "correlationId" | "destHost" | "projectId">> & { page: number };

export function useEvents(filters: EventFilters) {
  const api = useApi();
  return useQuery({
    queryKey: ["events", filters],
    queryFn: () => api.get("/v1/events", EventPageSchema, { ...filters, pageSize: 25 }),
    placeholderData: (previous) => previous,
  });
}
