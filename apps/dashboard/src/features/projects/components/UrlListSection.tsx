import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../../../shared/ui/Button.js";
import { DataTable } from "../../../shared/ui/DataTable.js";
import { TextField } from "../../../shared/ui/Field.js";
import { QueryBoundary } from "../../../shared/ui/QueryBoundary.js";
import { Notice } from "../../../shared/ui/States.js";
import { describeError } from "../../../shared/lib/format.js";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";

interface Entry {
  readonly id: string;
  readonly host: string;
  readonly repoPath: string;
}

/** A list of Git repositories with add (URL) and remove. Used for approved destinations and canonical repos. */
export function UrlListSection({
  title,
  hint,
  query,
  add,
  remove,
}: {
  title: string;
  hint: string;
  query: UseQueryResult<readonly Entry[]>;
  add: UseMutationResult<unknown, Error, string>;
  remove: UseMutationResult<unknown, Error, string>;
}): ReactNode {
  const [url, setUrl] = useState("");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    add.mutate(url, { onSuccess: () => setUrl("") });
  };
  const error = add.isError ? describeError(add.error) : remove.isError ? describeError(remove.error) : undefined;
  return (
    <section aria-label={title} className="space-y-3">
      <div>
        <h2 className="font-medium">{title}</h2>
        <p className="text-sm text-slate-500">{hint}</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <TextField label={`Add to ${title.toLowerCase()}`} placeholder="https://github.com/owner/repo or git@host:owner/repo" required value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <Button type="submit" busy={add.isPending}>
          Add
        </Button>
      </form>
      {error === undefined ? null : <Notice tone="error">{error}</Notice>}
      <QueryBoundary query={query} isEmpty={(rows) => rows.length === 0} emptyTitle="None yet">
        {(rows) => (
          <DataTable
            label={title}
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              { header: "Repository (normalised)", cell: (r) => <span className="break-all">{`${r.host}/${r.repoPath}`}</span> },
              { header: "", cell: (r) => <Button variant="secondary" onClick={() => remove.mutate(r.id)}>Remove</Button> },
            ]}
          />
        )}
      </QueryBoundary>
    </section>
  );
}
