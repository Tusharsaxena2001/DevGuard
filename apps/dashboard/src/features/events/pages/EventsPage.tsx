import { useState, type ReactNode } from "react";
import { OutcomeSchema, type Outcome } from "@devguard/shared";
import { EventTable } from "../../../shared/ui/EventTable.js";
import { SelectField, TextField } from "../../../shared/ui/Field.js";
import { PageHeader } from "../../../shared/ui/PageHeader.js";
import { Pagination } from "../../../shared/ui/Pagination.js";
import { QueryBoundary } from "../../../shared/ui/QueryBoundary.js";
import { useEvents } from "../api/events.js";

export function EventsPage(): ReactNode {
  const [outcome, setOutcome] = useState<Outcome | "">("");
  const [ruleId, setRuleId] = useState("");
  const [reference, setReference] = useState("");
  const [page, setPage] = useState(1);
  const query = useEvents({ page, ...(outcome === "" ? {} : { outcome }), ...(ruleId.trim() === "" ? {} : { ruleId: ruleId.trim() }), ...(reference.trim() === "" ? {} : { correlationId: reference.trim() }) });

  const reset = (apply: () => void): void => {
    apply();
    setPage(1);
  };

  return (
    <>
      <PageHeader title="Events" subtitle="Every push attempt the DevGuard hook observed, newest first." />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SelectField label="Decision" value={outcome} onChange={(e) => reset(() => setOutcome(e.target.value === "" ? "" : OutcomeSchema.parse(e.target.value)))}>
          <option value="">All</option>
          {OutcomeSchema.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </SelectField>
        <TextField label="Rule" placeholder="e.g. secret_detected" value={ruleId} onChange={(e) => reset(() => setRuleId(e.target.value))} />
        <TextField label="Reference (shown to the developer)" value={reference} onChange={(e) => reset(() => setReference(e.target.value))} />
      </div>
      <QueryBoundary query={query} isEmpty={(d) => d.total === 0} emptyTitle="No events match" emptyHint="Events appear when a laptop with the DevGuard agent attempts a push.">
        {(data) => (
          <div className="space-y-3">
            <EventTable events={data.items} />
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
