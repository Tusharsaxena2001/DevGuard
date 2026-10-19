import type { SessionUser } from "@devguard/shared";
import type { ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useLogout, useSession } from "../features/auth/api/session.js";
import { ErrorState, LoadingState } from "../shared/ui/States.js";
import { describeError } from "../shared/lib/format.js";
import { Button } from "../shared/ui/Button.js";
import { Layout } from "./Layout.js";

export function ForbiddenPage({ user }: { user: SessionUser }): ReactNode {
  const logout = useLogout();
  return (
    <main className="mx-auto mt-8 max-w-md rounded-lg bg-white p-6 ring-1 ring-slate-200 sm:mt-24">
      <h1 className="text-lg font-semibold">This dashboard is for security administrators</h1>
      <p className="mt-2 text-sm text-slate-600">
        You are signed in as {user.name}, but your account is not a security administrator. Ask one to change what you need, or to approve your exception request. Your laptop keeps protecting your pushes either way.
      </p>
      <Button variant="secondary" className="mt-4" onClick={() => logout.mutate()}>
        Sign out
      </Button>
    </main>
  );
}

/**
 * Navigation guard. Hiding pages is a convenience: every call is still checked by the API, which is the real access control.
 */
export function RequireAdmin(): ReactNode {
  const session = useSession();
  if (session.isPending) return <LoadingState label="Checking your session..." />;
  if (session.isError) return <ErrorState message={describeError(session.error)} onRetry={() => void session.refetch()} />;
  if (session.data === null) return <Navigate to="/login" replace />;
  if (!session.data.isAdmin) return <ForbiddenPage user={session.data} />;
  return (
    <Layout user={session.data}>
      <Outlet />
    </Layout>
  );
}
