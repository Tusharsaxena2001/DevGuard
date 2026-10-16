import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { UserSummarySchema, type CreateUserRequest } from "@devguard/shared";
import { useApi } from "./api-context.js";

const UsersSchema = z.array(UserSummarySchema);

/** Users are needed by more than one feature (project members, enrollment tokens), so they live here, not in a feature. */
export function useUsers() {
  const api = useApi();
  return useQuery({ queryKey: ["users"], queryFn: () => api.get("/v1/users", UsersSchema) });
}

export function useCreateUser() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserRequest) => api.send("POST", "/v1/users", UserSummarySchema, body),
    onSuccess: () => client.invalidateQueries({ queryKey: ["users"] }),
  });
}
