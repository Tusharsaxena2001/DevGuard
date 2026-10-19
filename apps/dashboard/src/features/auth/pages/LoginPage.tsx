import { useState, type FormEvent, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "../../../shared/ui/Button.js";
import { TextField } from "../../../shared/ui/Field.js";
import { Notice } from "../../../shared/ui/States.js";
import { ApiRequestError } from "../../../shared/lib/api-client.js";
import { describeError } from "../../../shared/lib/format.js";
import { useLogin, useSession } from "../api/session.js";

export function LoginPage(): ReactNode {
  const session = useSession();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (session.data) return <Navigate to="/" replace />;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    login.mutate({ email, password });
  };
  const failed = login.error instanceof ApiRequestError && login.error.status === 401 ? "Invalid email or password." : login.isError ? describeError(login.error) : undefined;

  return (
    <main className="mx-auto mt-8 max-w-sm rounded-lg bg-white p-6 ring-1 ring-slate-200 sm:mt-24">
      <h1 className="text-lg font-semibold">DevGuard</h1>
      <p className="mt-1 text-sm text-slate-500">Sign in to review pushes, exceptions and policy changes.</p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <TextField label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {failed === undefined ? null : <Notice tone="error">{failed}</Notice>}
        <Button type="submit" busy={login.isPending} className="w-full justify-center">
          Sign in
        </Button>
      </form>
    </main>
  );
}
