import { useState, type ReactNode } from "react";
import { MetricsRangeSchema, type MetricsRange, type MetricsSummary } from "@devguard/shared";
import { DataTable } from "../../../shared/ui/DataTable.js";
import { EventTable } from "../../../shared/ui/EventTable.js";
import { SelectField } from "../../../shared/ui/Field.js";
import { PageHeader } from "../../../shared/ui/PageHeader.js";
import { QueryBoundary } from "../../../shared/ui/QueryBoundary.js";
import { useMetrics } from "../api/metrics.js";

const RANGE_LABEL: Record<MetricsRange, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" };

function Tile({ label, value, hint }: { label: string; value: number; hint?: string }): ReactNode {
  return (
    <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint === undefined ? null : <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Summary({ m }: { m: MetricsSummary }): ReactNode {
  return (
    <div className="space-y-6">
      <section aria-label="Decisions" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Allowed" value={m.outcomes.allowed} />
        <Tile label="Blocked" value={m.outcomes.blocked} />
        <Tile label="Allowed by exception" value={m.outcomes.exception} />
        <Tile label="Could not check" value={m.outcomes.error} hint="blocked or recorded, see Events" />
      </section>
      <section aria-label="Exceptions and devices" className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Pending approvals" value={m.exceptions.pending} />
        <Tile label="Exceptions in force" value={m.exceptions.inForce} />
        <Tile label="Active devices" value={m.devices.active} />
        <Tile label="Stale devices" value={m.devices.stale} hint="not heard from in 24 hours" />
        <Tile label="Revoked devices" value={m.devices.revoked} />
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Top rules">
          <h2 className="mb-2 font-medium">Top rules</h2>
          {m.topRules.length === 0 ? <p className="text-sm text-slate-500">No rule has fired in this period.</p> : <DataTable rows={m.topRules} rowKey={(r) => r.ruleId} columns={[{ header: "Rule", cell: (r) => r.ruleId }, { header: "Events", cell: (r) => r.count }]} />}
        </section>
        <section aria-label="Blocked per day">
          <h2 className="mb-2 font-medium">Blocked pushes per day</h2>
          {m.blockedPerDay.length === 0 ? (
            <p className="text-sm text-slate-500">No blocked pushes in this period.</p>
          ) : (
            <DataTable rows={m.blockedPerDay} rowKey={(r) => `${r.day}-${r.projectId ?? "none"}`} columns={[{ header: "Day (UTC)", cell: (r) => r.day }, { header: "Project", cell: (r) => r.projectName ?? "no project" }, { header: "Blocked", cell: (r) => r.blocked }]} />
          )}
        </section>
      </div>
      <section aria-label="Recent incidents">
        <h2 className="mb-2 font-medium">Recent blocked pushes</h2>
        {m.recentIncidents.length === 0 ? <p className="text-sm text-slate-500">Nothing has been blocked yet.</p> : <EventTable events={m.recentIncidents} />}
      </section>
      <p className="text-xs text-slate-500">Numbers count pushes the DevGuard hook reported. Pushes made with --no-verify, another Git client, or on a laptop without the agent are not included.</p>
    </div>
  );
}

export function OverviewPage(): ReactNode {
  const [range, setRange] = useState<MetricsRange>("7d");
  const query = useMetrics(range);
  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="What DevGuard has seen and decided."
        actions={
          <div className="w-full sm:w-44">
            <SelectField label="Period" value={range} onChange={(e) => setRange(MetricsRangeSchema.parse(e.target.value))}>
              {MetricsRangeSchema.options.map((r) => (
                <option key={r} value={r}>
                  {RANGE_LABEL[r]}
                </option>
              ))}
            </SelectField>
          </div>
        }
      />
      <QueryBoundary query={query}>{(m) => <Summary m={m} />}</QueryBoundary>
    </>
  );
}
