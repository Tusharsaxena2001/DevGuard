import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../../../shared/ui/Button.js";
import { DataTable } from "../../../shared/ui/DataTable.js";
import { TextField } from "../../../shared/ui/Field.js";
import { QueryBoundary } from "../../../shared/ui/QueryBoundary.js";
import { Notice } from "../../../shared/ui/States.js";
import { StatusBadge } from "../../../shared/ui/StatusBadge.js";
import { describeError, formatTime } from "../../../shared/lib/format.js";
import { useAddFingerprint, useFingerprints, useRegisteredRepos, useRemoveFingerprint } from "../api/projects.js";

/** How a laptop recognises the project's repos even if the remote is changed (root commits), and which laptops reported them. */
export function FingerprintsSection({ projectId }: { projectId: string }): ReactNode {
  const fingerprints = useFingerprints(projectId);
  const registered = useRegisteredRepos(projectId);
  const add = useAddFingerprint(projectId);
  const remove = useRemoveFingerprint(projectId);
  const [value, setValue] = useState("");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    add.mutate(value.trim().toLowerCase(), { onSuccess: () => setValue("") });
  };
  const error = add.isError ? describeError(add.error) : remove.isError ? describeError(remove.error) : undefined;
  return (
    <section aria-label="Detected repositories" className="space-y-3">
      <div>
        <h2 className="font-medium">Detected repositories</h2>
        <p className="text-sm text-slate-500">
          Laptops report the first commit of repos they recognise by remote, so a repo is still protected if its remote is changed. Reports are attributed to the device and can be removed here. A wrong entry can only make a repo stricter, never looser.
        </p>
      </div>
      <form onSubmit={submit} className="flex items-end gap-3">
        <div className="flex-1">
          <TextField label="Add a first-commit hash manually" placeholder="40 hex characters" required value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <Button type="submit" busy={add.isPending}>
          Add
        </Button>
      </form>
      {error === undefined ? null : <Notice tone="error">{error}</Notice>}
      <QueryBoundary query={fingerprints} isEmpty={(rows) => rows.length === 0} emptyTitle="None yet" emptyHint="They appear after the first push from a recognised repo.">
        {(rows) => (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              { header: "First commit", cell: (r) => <code>{r.fingerprint.slice(0, 12)}</code> },
              { header: "Source", cell: (r) => (r.source === "device" ? `reported by device ${r.reportedByDeviceId?.slice(0, 8) ?? ""}` : "added by an administrator") },
              { header: "Since", cell: (r) => formatTime(r.createdAt) },
              { header: "", cell: (r) => <Button variant="secondary" onClick={() => remove.mutate(r.id)}>Remove</Button> },
            ]}
          />
        )}
      </QueryBoundary>
      <h3 className="pt-2 text-sm font-medium">Repos registered by hand on laptops</h3>
      <QueryBoundary query={registered} isEmpty={(rows) => rows.length === 0} emptyTitle="None">
        {(rows) => (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              { header: "Device", cell: (r) => r.deviceName },
              { header: "First commit", cell: (r) => <code>{r.fingerprint.slice(0, 12)}</code> },
              { header: "Registered", cell: (r) => <><StatusBadge value="active" /> {formatTime(r.registeredAt)}</> },
            ]}
          />
        )}
      </QueryBoundary>
    </section>
  );
}
