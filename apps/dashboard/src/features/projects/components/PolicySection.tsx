import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { EnforcementModeSchema, type EnforcementMode, type ProjectPolicy } from "@devguard/shared";
import { Button } from "../../../shared/ui/Button.js";
import { DataTable } from "../../../shared/ui/DataTable.js";
import { SelectField, TextArea } from "../../../shared/ui/Field.js";
import { QueryBoundary } from "../../../shared/ui/QueryBoundary.js";
import { Notice } from "../../../shared/ui/States.js";
import { StatusBadge } from "../../../shared/ui/StatusBadge.js";
import { describeError, formatTime } from "../../../shared/lib/format.js";
import { usePolicy, usePolicyVersions, useUpdatePolicy } from "../api/projects.js";

const lines = (text: string): string[] => text.split("\n").map((l) => l.trim()).filter((l) => l !== "");

function Editor({ projectId, policy }: { projectId: string; policy: ProjectPolicy }): ReactNode {
  const update = useUpdatePolicy(projectId);
  const [mode, setMode] = useState<EnforcementMode>(policy.mode);
  const [globs, setGlobs] = useState(policy.prohibitedGlobs.join("\n"));
  const [rules, setRules] = useState(policy.secretRules.join("\n"));
  // A new version from the server (ours or someone else's) replaces what is in the form.
  useEffect(() => {
    setMode(policy.mode);
    setGlobs(policy.prohibitedGlobs.join("\n"));
    setRules(policy.secretRules.join("\n"));
  }, [policy]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    update.mutate({ baseVersion: policy.version, mode, prohibitedGlobs: lines(globs), secretRules: lines(rules) });
  };
  const conflict = update.isError && "code" in update.error && update.error.code === "conflict";

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg bg-white p-4 ring-1 ring-slate-200">
      <p className="text-sm text-slate-500">Editing version {policy.version}. Saving creates version {policy.version + 1}; earlier versions stay in the history.</p>
      <SelectField label="Mode" value={mode} onChange={(e) => setMode(EnforcementModeSchema.parse(e.target.value))}>
        <option value="enforce">Enforce: block pushes that break the rules</option>
        <option value="audit_only">Audit only: allow, but record what would have been blocked</option>
      </SelectField>
      <TextArea label="Prohibited file patterns (one per line)" value={globs} onChange={(e) => setGlobs(e.target.value)} />
      <TextArea label="Secret rules (rule ids, one per line)" value={rules} onChange={(e) => setRules(e.target.value)} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" busy={update.isPending}>
          Save new version
        </Button>
        {update.isSuccess ? <Notice tone="success">Saved. Laptops pick it up at their next push or sync.</Notice> : null}
        {update.isError ? <Notice tone="error">{conflict ? "Someone else changed this policy first. The latest version is loaded; review it and save again." : describeError(update.error)}</Notice> : null}
      </div>
    </form>
  );
}

export function PolicySection({ projectId }: { projectId: string }): ReactNode {
  const policy = usePolicy(projectId);
  const versions = usePolicyVersions(projectId);
  return (
    <section aria-label="Policy" className="space-y-3">
      <h2 className="font-medium">Policy</h2>
      <QueryBoundary query={policy}>{(p) => <Editor projectId={projectId} policy={p} />}</QueryBoundary>
      <h3 className="pt-2 text-sm font-medium">Version history</h3>
      <QueryBoundary query={versions} isEmpty={(v) => v.length === 0}>
        {(rows) => (
          <DataTable
            label="Policy version history"
            rows={rows}
            rowKey={(v) => String(v.version)}
            columns={[
              { header: "Version", cell: (v) => v.version },
              { header: "Mode", cell: (v) => <StatusBadge value={v.mode} /> },
              { header: "File patterns", cell: (v) => v.prohibitedGlobs.length },
              { header: "Secret rules", cell: (v) => v.secretRules.length },
              { header: "Saved", cell: (v) => formatTime(v.createdAt) },
            ]}
          />
        )}
      </QueryBoundary>
    </section>
  );
}
