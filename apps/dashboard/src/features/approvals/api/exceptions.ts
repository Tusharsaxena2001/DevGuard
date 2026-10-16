import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExceptionEntrySchema, ExceptionPageSchema, type ExceptionStatus } from "@devguard/shared";
import { useApi } from "../../../shared/api/api-context.js";

export function useExceptions(status: ExceptionStatus | undefined, page: number) {
  const api = useApi();
  return useQuery({
    queryKey: ["exceptions", status ?? "all", page],
    queryFn: () => api.get("/v1/exceptions", ExceptionPageSchema, { ...(status === undefined ? {} : { status }), page, pageSize: 25 }),
    placeholderData: (previous) => previous,
  });
}

type Decision = { id: string } & ({ kind: "approve"; reason: string; expiresAt: string } | { kind: "reject" | "revoke"; reason: string });

export function useDecide() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (d: Decision) =>
      api.send("POST", `/v1/exceptions/${d.id}/${d.kind}`, ExceptionEntrySchema, d.kind === "approve" ? { reason: d.reason, expiresAt: d.expiresAt } : { reason: d.reason }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["exceptions"] }),
  });
}
