import { useEffect, useState, type ReactNode } from "react";
import type { ProjectSummary } from "@devguard/shared";
import { useUsers } from "../../../shared/api/users.js";
import { Button } from "../../../shared/ui/Button.js";
import { QueryBoundary } from "../../../shared/ui/QueryBoundary.js";
import { Notice } from "../../../shared/ui/States.js";
import { describeError } from "../../../shared/lib/format.js";
import { useSetMembers } from "../api/projects.js";

/** Who the project covers. Only these people's laptops receive the project at their next sync. */
export function MembersSection({ project }: { project: ProjectSummary }): ReactNode {
  const users = useUsers();
  const save = useSetMembers(project.id);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(project.memberIds));
  useEffect(() => setSelected(new Set(project.memberIds)), [project.memberIds]);

  const toggle = (id: string): void =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section aria-label="People covered" className="space-y-3">
      <div>
        <h2 className="font-medium">People covered</h2>
        <p className="text-sm text-slate-500">Only these people's laptops receive this project's rules, at their next sync. Removing someone drops the project from their laptop.</p>
      </div>
      <QueryBoundary query={users} isEmpty={(rows) => rows.length === 0} emptyTitle="No users">
        {(rows) => (
          <ul className="grid gap-1 sm:grid-cols-2">
            {rows
              .filter((u) => u.status === "active")
              .map((u) => (
                <li key={u.id}>
                  <label className="flex min-h-11 items-center gap-3 rounded-md px-2 text-sm hover:bg-slate-100 lg:min-h-8">
                    <input type="checkbox" className="size-5 shrink-0 lg:size-4" checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
                    <span className="min-w-0 break-words">
                      {u.name} <span className="text-slate-500">{u.email}</span>
                    </span>
                  </label>
                </li>
              ))}
          </ul>
        )}
      </QueryBoundary>
      <div className="flex flex-wrap items-center gap-3">
        <Button busy={save.isPending} onClick={() => save.mutate([...selected])}>
          Save people
        </Button>
        {save.isSuccess ? <Notice tone="success">Saved.</Notice> : null}
        {save.isError ? <Notice tone="error">{describeError(save.error)}</Notice> : null}
      </div>
    </section>
  );
}
