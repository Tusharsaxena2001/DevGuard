import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useCreateUser, useUsers } from "../../../shared/api/users.js";
import { Button } from "../../../shared/ui/Button.js";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog.js";
import { CopyButton } from "../../../shared/ui/CopyButton.js";
import { DataTable } from "../../../shared/ui/DataTable.js";
import { SelectField, TextField } from "../../../shared/ui/Field.js";
import { PageHeader } from "../../../shared/ui/PageHeader.js";
import { QueryBoundary } from "../../../shared/ui/QueryBoundary.js";
import { Notice } from "../../../shared/ui/States.js";
import { StatusBadge } from "../../../shared/ui/StatusBadge.js";
import { describeError, formatTime } from "../../../shared/lib/format.js";
import { useDevices, useIssueToken, useRevokeDevice } from "../api/devices.js";

/** The one-time token with the exact command to run on the laptop. Both can be copied; neither is shown again after leaving the page. */
function TokenPanel({ token, expiresAt }: { token: string; expiresAt: string }): ReactNode {
  const command = `echo '${token}' | devguard enroll --server ${window.location.origin} --token-stdin`;
  return (
    <div className="space-y-3 rounded-md bg-amber-50 p-3 text-sm ring-1 ring-amber-200">
      <p role="status" className="font-medium">Copy this now. It is shown once and expires {formatTime(expiresAt)}.</p>
      <div className="space-y-2">
        <p className="text-slate-600">Token</p>
        <code className="block break-all rounded bg-white p-2">{token}</code>
        <CopyButton text={token} label="Copy token" />
      </div>
      <div className="space-y-2">
        <p className="text-slate-600">Run this on the laptop</p>
        <code className="block break-all rounded bg-white p-2">{command}</code>
        <CopyButton text={command} label="Copy command" />
      </div>
    </div>
  );
}

function EnrollmentToken(): ReactNode {
  const users = useUsers();
  const issue = useIssueToken();
  const [userId, setUserId] = useState("");
  const { reset } = issue;
  // Leaving the page forgets the token (it was shown once, and cannot be shown again).
  useEffect(() => reset, [reset]);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    issue.mutate(userId);
  };
  return (
    <section aria-label="Enroll a laptop" className="mb-6 space-y-3 rounded-lg bg-white p-4 ring-1 ring-slate-200">
      <h2 className="font-medium">Enroll a laptop</h2>
      <p className="text-sm text-slate-500">Issue a one-time token for a person. They run it once on their laptop; nothing else is needed from them.</p>
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <SelectField label="Person" required value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose...</option>
            {(users.data ?? [])
              .filter((u) => u.status === "active")
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
          </SelectField>
        </div>
        <Button type="submit" busy={issue.isPending} disabled={userId === ""} className="sm:shrink-0">
          Issue token
        </Button>
      </form>
      {issue.isError ? <Notice tone="error">{describeError(issue.error)}</Notice> : null}
      {issue.data === undefined ? null : <TokenPanel token={issue.data.token} expiresAt={issue.data.expiresAt} />}
    </section>
  );
}

function NewUser(): ReactNode {
  const create = useCreateUser();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const found: { name?: string; email?: string; password?: string } = {};
    if (name.trim() === "") found.name = "Enter a name.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) found.email = "Enter a valid email address.";
    if (password.length < 12) found.password = "Use at least 12 characters.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    create.mutate({ email, name, password, isAdmin: false }, { onSuccess: () => (setEmail(""), setName(""), setPassword("")) });
  };
  return (
    <section aria-label="Add a person" className="mb-6 space-y-3 rounded-lg bg-white p-4 ring-1 ring-slate-200">
      <h2 className="font-medium">Add a person</h2>
      <form onSubmit={submit} noValidate className="grid gap-3 lg:grid-cols-4 lg:items-end">
        <TextField label="Name" required error={errors.name} value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Email" type="email" required error={errors.email} value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Initial password (12+ characters)" type="password" required error={errors.password} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" busy={create.isPending} className="lg:self-end">
          Add person
        </Button>
      </form>
      {create.isError ? <Notice tone="error">{describeError(create.error)}</Notice> : null}
      {create.isSuccess ? <Notice tone="success">Added.</Notice> : null}
    </section>
  );
}

export function DevicesPage(): ReactNode {
  const devices = useDevices();
  const users = useUsers();
  const revoke = useRevokeDevice();
  const [pending, setPending] = useState<{ id: string; name: string } | undefined>(undefined);
  const owner = new Map((users.data ?? []).map((u) => [u.id, u.name]));
  const staleCutoff = Date.now() - 24 * 3_600_000;

  return (
    <>
      <PageHeader title="Devices and people" subtitle="Enrolled laptops, and the people who can sign in." />
      <EnrollmentToken />
      <NewUser />
      {revoke.isError ? <Notice tone="error">{describeError(revoke.error)}</Notice> : null}
      <QueryBoundary query={devices} isEmpty={(rows) => rows.length === 0} emptyTitle="No devices enrolled" emptyHint="Issue a token above and enroll a laptop.">
        {(rows) => (
          <DataTable
            label="Devices"
            rows={rows}
            rowKey={(d) => d.id}
            columns={[
              { header: "Device", cell: (d) => d.name, primary: true },
              { header: "Person", cell: (d) => owner.get(d.userId) ?? "unknown" },
              { header: "OS", cell: (d) => d.os },
              { header: "Agent", cell: (d) => d.agentVersion },
              {
                header: "Status",
                cell: (d) => <StatusBadge value={d.status === "revoked" ? "revoked" : d.lastSeenAt === null || Date.parse(d.lastSeenAt) < staleCutoff ? "stale" : "active"} />,
              },
              { header: "Last seen", cell: (d) => formatTime(d.lastSeenAt), nowrap: true },
              {
                header: "",
                cell: (d) =>
                  d.status === "revoked" ? null : (
                    <Button variant="danger" onClick={() => setPending({ id: d.id, name: d.name })}>
                      Revoke
                    </Button>
                  ),
              },
            ]}
          />
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={pending !== undefined}
        title={`Revoke ${pending?.name ?? "this device"}?`}
        confirmLabel="Revoke device"
        busy={revoke.isPending}
        onCancel={() => setPending(undefined)}
        onConfirm={() => pending !== undefined && revoke.mutate(pending.id, { onSettled: () => setPending(undefined) })}
      >
        Its credentials stop working immediately. The laptop is told it was revoked at its next push or sync. This cannot be undone; the person has to enroll again with a new token.
      </ConfirmDialog>
    </>
  );
}
