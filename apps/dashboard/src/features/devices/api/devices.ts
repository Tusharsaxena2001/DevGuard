import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { DeviceSummarySchema, EnrollmentTokenResponseSchema } from "@devguard/shared";
import { useApi } from "../../../shared/api/api-context.js";

export function useDevices() {
  const api = useApi();
  return useQuery({ queryKey: ["devices"], queryFn: () => api.get("/v1/devices", z.array(DeviceSummarySchema)) });
}

export function useIssueToken() {
  const api = useApi();
  // The token is a secret shown once: do not keep the result around after the screen is done with it.
  return useMutation({ gcTime: 0, mutationFn: (userId: string) => api.send("POST", "/v1/devices/enrollment-tokens", EnrollmentTokenResponseSchema, { userId }) });
}

export function useRevokeDevice() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.send("POST", `/v1/devices/${id}/revoke`, DeviceSummarySchema),
    onSuccess: () => client.invalidateQueries({ queryKey: ["devices"] }),
  });
}
