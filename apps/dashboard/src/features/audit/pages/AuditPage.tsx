import { useState, type ReactNode } from "react";
import { FilterPanel } from "../../../shared/ui/FilterPanel.js";
import { DataTable } from "../../../shared/ui/DataTable.js";
import { SelectField, TextField } from "../../../shared/ui/Field.js";
import { PageHeader } from "../../../shared/ui/PageHeader.js";
import { Pagination } from "../../../shared/ui/Pagination.js";
import { QueryBoundary } from "../../../shared/ui/QueryBoundary.js";
import { formatTime } from "../../../shared/lib/format.js";
import { useAudit } from "../api/audit.js";

const FAMILIES = ["user", "device", "project", "destination", "canonical_repo", "fingerprint", "repo", "policy", "exception"] as const;

export function AuditPage(): ReactNode {
  const [family, setFamily] = useState("");
  const [target, setTarget] = useState("");
  const [page, setPage] = useState(1);
  const query = useAudit({ page, ...(family === "" ? {} : { actionPrefix: family }), ...(target.trim() === "" ? {} : { targetId: target.trim() }) });
  return (
    <>
      <PageHeader title="Audit history" subtitle="Who changed what, newest first. This history is append-only: it cannot be edited or deleted." />
      <FilterPanel activeCount={[family, target.trim()].filter((v) => v !== "").length}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SelectField label="Kind of change" value={family} onChange={(e) => (setFamily(e.target.value), setPage(1))}>
          <option value="">All</option>
          {FAMILIES.map((f) => (
            <option key={f} value={f}>
              {f.replaceAll("_", " ")}
            </option>
          ))}
        </SelectField>
        <TextField label="Target id (project, device, request...)" value={target} onChange={(e) => (setTarget(e.target.value), setPage(1))} />
      </div>
      </FilterPanel>
      <QueryBoundary query={query} isEmpty={(d) => d.total === 0} emptyTitle="No changes match">
        {(data) => (
          <div className="space-y-3">
            <DataTable
              label="Audit history"
              rows={data.items}
              rowKey={(a) => a.id}
              columns={[
                { header: "When", cell: (a) => formatTime(a.occurredAt), nowrap: true },
                { header: "Who", cell: (a) => a.actorName },
                { header: "Action", cell: (a) => a.action.replaceAll("_", " "), primary: true },
                { header: "Target", cell: (a) => `${a.targetType} ${a.targetId.slice(0, 8)}` },
                { header: "Details", cell: (a) => Object.entries(a.summary).map(([k, v]) => `${k}: ${String(v)}`).join(", ") || "-" },
              ]}
            />
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
