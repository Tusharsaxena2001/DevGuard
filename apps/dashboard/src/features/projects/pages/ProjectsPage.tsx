import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ClassificationSchema, type Classification } from "@devguard/shared";
import { Button } from "../../../shared/ui/Button.js";
import { DataTable } from "../../../shared/ui/DataTable.js";
import { SelectField, TextField } from "../../../shared/ui/Field.js";
import { PageHeader } from "../../../shared/ui/PageHeader.js";
import { QueryBoundary } from "../../../shared/ui/QueryBoundary.js";
import { Notice } from "../../../shared/ui/States.js";
import { StatusBadge } from "../../../shared/ui/StatusBadge.js";
import { describeError } from "../../../shared/lib/format.js";
import { useCreateProject, useProjects } from "../api/projects.js";

export function ProjectsPage(): ReactNode {
  const projects = useProjects();
  const create = useCreateProject();
  const [name, setName] = useState("");
  const [classification, setClassification] = useState<Classification>("confidential");

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    create.mutate({ name, classification }, { onSuccess: () => setName("") });
  };

  return (
    <>
      <PageHeader title="Projects" subtitle="A project says which code is protected, where it may be pushed, and who is covered." />
      <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-white p-4 ring-1 ring-slate-200">
        <div className="w-full sm:min-w-56 sm:flex-1">
          <TextField label="New project name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="w-full sm:w-48">
          <SelectField label="Classification" value={classification} onChange={(e) => setClassification(ClassificationSchema.parse(e.target.value))}>
            {ClassificationSchema.options.map((c) => (
              <option key={c} value={c}>
                {c.replaceAll("_", " ")}
              </option>
            ))}
          </SelectField>
        </div>
        <Button type="submit" busy={create.isPending} className="w-full sm:w-auto">
          Create project
        </Button>
        {create.isError ? <Notice tone="error">{describeError(create.error)}</Notice> : null}
      </form>
      <QueryBoundary query={projects} isEmpty={(p) => p.length === 0} emptyTitle="No projects yet" emptyHint="Create one above, then add its approved destinations and assign the people it covers.">
        {(rows) => (
          <DataTable
            label="Projects"
            rows={rows}
            rowKey={(p) => p.id}
            columns={[
              { header: "Project", cell: (p) => <Link className="inline-flex min-h-11 items-center lg:min-h-0 font-medium text-slate-900 underline" to={`/projects/${p.id}`}>{p.name}</Link> },
              { header: "Classification", cell: (p) => <StatusBadge value={p.classification} /> },
              { header: "People", cell: (p) => p.memberIds.length },
            ]}
          />
        )}
      </QueryBoundary>
    </>
  );
}
