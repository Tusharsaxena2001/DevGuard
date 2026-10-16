import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CanonicalRepoEntrySchema,
  DestinationEntrySchema,
  FingerprintEntrySchema,
  PolicyVersionEntrySchema,
  ProjectPolicySchema,
  ProjectSummarySchema,
  RepoRegistrationEntrySchema,
  type CreateProjectRequest,
  type PolicyUpdateRequest,
  type UpdateProjectRequest,
} from "@devguard/shared";
import { useApi } from "../../../shared/api/api-context.js";

const key = (...parts: string[]) => ["projects", ...parts] as const;

export function useProjects() {
  const api = useApi();
  return useQuery({ queryKey: key(), queryFn: () => api.get("/v1/projects", z.array(ProjectSummarySchema)) });
}

export function useProject(id: string) {
  const api = useApi();
  return useQuery({ queryKey: key(id), queryFn: () => api.get(`/v1/projects/${id}`, ProjectSummarySchema) });
}

/** Runs a mutation and refreshes everything shown for the project (and the project list). */
function useProjectMutation<T, V>(id: string | undefined, run: (api: ReturnType<typeof useApi>, variables: V) => Promise<T>) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({ mutationFn: (variables: V) => run(api, variables), onSuccess: () => client.invalidateQueries({ queryKey: id === undefined ? key() : ["projects"] }) });
}

export const useCreateProject = () => useProjectMutation(undefined, (api, body: CreateProjectRequest) => api.send("POST", "/v1/projects", ProjectSummarySchema, body));
export const useUpdateProject = (id: string) => useProjectMutation(id, (api, body: UpdateProjectRequest) => api.send("PATCH", `/v1/projects/${id}`, ProjectSummarySchema, body));
export const useSetMembers = (id: string) => useProjectMutation(id, (api, userIds: string[]) => api.send("PUT", `/v1/projects/${id}/members`, ProjectSummarySchema, { userIds }));

export function useDestinations(id: string) {
  const api = useApi();
  return useQuery({ queryKey: key(id, "destinations"), queryFn: () => api.get(`/v1/projects/${id}/destinations`, z.array(DestinationEntrySchema)) });
}
export const useAddDestination = (id: string) => useProjectMutation(id, (api, url: string) => api.send("POST", `/v1/projects/${id}/destinations`, DestinationEntrySchema, { url }));
export const useRemoveDestination = (id: string) => useProjectMutation(id, (api, entry: string) => api.send("DELETE", `/v1/projects/${id}/destinations/${entry}`, z.undefined()));

export function useCanonicalRepos(id: string) {
  const api = useApi();
  return useQuery({ queryKey: key(id, "canonical"), queryFn: () => api.get(`/v1/projects/${id}/canonical-repos`, z.array(CanonicalRepoEntrySchema)) });
}
export const useAddCanonicalRepo = (id: string) => useProjectMutation(id, (api, url: string) => api.send("POST", `/v1/projects/${id}/canonical-repos`, CanonicalRepoEntrySchema, { url }));
export const useRemoveCanonicalRepo = (id: string) => useProjectMutation(id, (api, entry: string) => api.send("DELETE", `/v1/projects/${id}/canonical-repos/${entry}`, z.undefined()));

export function useFingerprints(id: string) {
  const api = useApi();
  return useQuery({ queryKey: key(id, "fingerprints"), queryFn: () => api.get(`/v1/projects/${id}/fingerprints`, z.array(FingerprintEntrySchema)) });
}
export const useAddFingerprint = (id: string) => useProjectMutation(id, (api, fingerprint: string) => api.send("POST", `/v1/projects/${id}/fingerprints`, FingerprintEntrySchema, { fingerprint }));
export const useRemoveFingerprint = (id: string) => useProjectMutation(id, (api, entry: string) => api.send("DELETE", `/v1/projects/${id}/fingerprints/${entry}`, z.undefined()));

export function useRegisteredRepos(id: string) {
  const api = useApi();
  return useQuery({ queryKey: key(id, "repos"), queryFn: () => api.get(`/v1/projects/${id}/repos`, z.array(RepoRegistrationEntrySchema)) });
}

export function usePolicy(id: string) {
  const api = useApi();
  return useQuery({ queryKey: key(id, "policy"), queryFn: () => api.get(`/v1/projects/${id}/policy`, ProjectPolicySchema) });
}
export function usePolicyVersions(id: string) {
  const api = useApi();
  return useQuery({ queryKey: key(id, "versions"), queryFn: () => api.get(`/v1/projects/${id}/policy/versions`, z.array(PolicyVersionEntrySchema)) });
}
export const useUpdatePolicy = (id: string) => useProjectMutation(id, (api, body: PolicyUpdateRequest) => api.send("PUT", `/v1/projects/${id}/policy`, ProjectPolicySchema, body));
