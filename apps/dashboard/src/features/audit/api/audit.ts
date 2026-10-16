import { useQuery } from "@tanstack/react-query";
import { AuditPageSchema } from "@devguard/shared";
import { useApi } from "../../../shared/api/api-context.js";

export interface AuditFilters {
  readonly actionPrefix?: string;
  readonly targetId?: string;
  readonly page: number;
}

export function useAudit(filters: AuditFilters) {
  const api = useApi();
  return useQuery({ queryKey: ["audit", filters], queryFn: () => api.get("/v1/audit", AuditPageSchema, { ...filters, pageSize: 25 }), placeholderData: (previous) => previous });
}
