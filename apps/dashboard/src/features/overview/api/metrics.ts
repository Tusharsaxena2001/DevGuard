import { useQuery } from "@tanstack/react-query";
import { MetricsSummarySchema, type MetricsRange } from "@devguard/shared";
import { useApi } from "../../../shared/api/api-context.js";

export function useMetrics(range: MetricsRange) {
  const api = useApi();
  return useQuery({ queryKey: ["metrics", range], queryFn: () => api.get("/v1/metrics/summary", MetricsSummarySchema, { range }), refetchInterval: 30_000 });
}
