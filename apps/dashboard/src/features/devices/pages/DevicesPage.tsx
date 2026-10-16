import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useCreateUser, useUsers } from "../../../shared/api/users.js";
import { Button } from "../../../shared/ui/Button.js";
import { DataTable } from "../../../shared/ui/DataTable.js";
import { SelectField, TextField } from "../../../shared/ui/Field.js";
import { PageHeader } from "../../../shared/ui/PageHeader.js";
import { QueryBoundary } from "../../../shared/ui/QueryBoundary.js";
import { Notice } from "../../../shared/ui/States.js";
import { StatusBadge } from "../../../shared/ui/StatusBadge.js";
import { describeError, formatTime } from "../../../shared/lib/format.js";
import { useDevices, useIssueToken, useRevokeDevice } from "../api/devices.js";

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
      <form onSubmit={submit} className="flex items-end gap-3">
        <div className="flex-1">
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
        <Button type="submit" busy={issue.isPending} disabled={userId === ""}>
          Issue token
        </Button>
      </form>
      {issue.isError ? <Notice tone="error">{describeError(issue.error)}</Notice> : null}
      {issue.data === undefined ? null : (
        <div role="status" className="space-y-2 rounded-md bg-amber-50 p-3 text-sm ring-1 ring-amber-200">
          <p className="font-medium">Copy this now. It is shown once and expires {formatTime(issue.data.expiresAt)}.</p>
          <code className="block break-all rounded bg-white p-2">{issue.data.token}</code>
          <p className="text-slate-600">On the laptop: <code>echo '&lt;token&gt;' | devguard enroll --server &lt;this server&gt; --token-stdin</code></p>
        </div>
      )}
    </section>
  );
}

function NewUser(): ReactNode {
  const create = useCreateUser();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    create.mutate({ email, name, password, isAdmin: false }, { onSuccess: () => (setEmail(""), setName(""), setPassword("")) });
  };
  return (
    <section aria-label="Add a person" className="mb-6 space-y-3 rounded-lg bg-white p-4 ring-1 ring-slate-200">
      <h2 className="font-medium">Add a person</h2>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4 sm:items-end">
        <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Initial password (12+ characters)" type="password" minLength={12} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" busy={create.isPending}>
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
            rows={rows}
            rowKey={(d) => d.id}
            columns={[
              { header: "Person", cell: (d) => owner.get(d.userId) ?? "unknown" },
              { header: "Device", cell: (d) => d.name },
              { header: "OS", cell: (d) => d.os },
              { header: "Agent", cell: (d) => d.agentVersion },
              {
                header: "Status",
                cell: (d) => <StatusBadge value={d.status === "revoked" ? "revoked" : d.lastSeenAt === null || Date.parse(d.lastSeenAt) < staleCutoff ? "stale" : "active"} />,
              },
              { header: "Last seen", cell: (d) => formatTime(d.lastSeenAt) },
              {
                header: "",
                cell: (d) =>
                  d.status === "revoked" ? null : (
                    <Button variant="danger" onClick={() => window.confirm(`Revoke ${d.name}? Its credentials stop working immediately.`) && revoke.mutate(d.id)}>
                      Revoke
                    </Button>
                  ),
              },
            ]}
          />
        )}
      </QueryBoundary>
    </>
  );
}
