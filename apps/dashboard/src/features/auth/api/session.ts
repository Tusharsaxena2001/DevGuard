import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { SessionUserSchema, type LoginRequest, type SessionUser } from "@devguard/shared";
import { useApi } from "../../../shared/api/api-context.js";
import { ApiRequestError } from "../../../shared/lib/api-client.js";

const SESSION_KEY = ["session"] as const;

/** The signed-in user, or `null` when there is no valid session (a 401 is an answer here, not an error). */
export function useSession() {
  const api = useApi();
  return useQuery<SessionUser | null>({
    queryKey: SESSION_KEY,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        return await api.get("/v1/auth/me", SessionUserSchema);
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) return null;
        throw error;
      }
    },
  });
}

export function useLogin() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationKey: ["login"],
    mutationFn: (body: LoginRequest) => api.send("POST", "/v1/auth/login", SessionUserSchema, body),
    onSuccess: (user) => {
      // Nothing cached for whoever was here before (an expired session, another admin on the same tab) may be shown.
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] });
      client.setQueryData(SESSION_KEY, user);
    },
  });
}

export function useLogout() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.send("POST", "/v1/auth/logout", z.undefined()),
    // Drop everything cached for the previous person (whether or not the call succeeded), and mark the session as gone.
    // The session query itself is kept and updated in place: clearing the whole cache would detach its observer and leave
    // the screen showing the signed-in view.
    onSettled: () => {
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] });
      client.getMutationCache().clear();
      client.setQueryData(SESSION_KEY, null);
    },
  });
}
