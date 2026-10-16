import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "../shared/lib/api-client.js";

const SESSION_KEY = ["session"] as const;

/**
 * The app's query client. If the server says 401 to anything (the session expired or was revoked), the session is
 * marked gone, so the guard sends the person to the login page instead of leaving them on a screen whose actions fail.
 */
export function createQueryClient(options: { retry?: number } = {}): QueryClient {
  const signedOut = (error: unknown, key: readonly unknown[] | undefined): void => {
    if (error instanceof ApiRequestError && error.status === 401 && key?.[0] !== SESSION_KEY[0]) client.setQueryData(SESSION_KEY, null);
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => signedOut(error, query.queryKey) }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        // The login form itself answers 401 for a wrong password: that is not "the session expired".
        if (mutation.options.mutationKey?.[0] !== "login") signedOut(error, undefined);
      },
    }),
    defaultOptions: { queries: { retry: options.retry ?? 1, refetchOnWindowFocus: false } },
  });
  return client;
}
