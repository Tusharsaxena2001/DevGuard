import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createApiClient, type ApiClient } from "../lib/api-client.js";

const ApiContext = createContext<ApiClient | undefined>(undefined);

/** Provides the API client. Tests pass a client built on a fake `fetch`. */
export function ApiProvider({ client, children }: { client?: ApiClient; children: ReactNode }): ReactNode {
  const value = useMemo(() => client ?? createApiClient(), [client]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (client === undefined) throw new Error("useApi must be used inside <ApiProvider>");
  return client;
}
