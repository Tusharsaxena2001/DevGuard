import { useState, type ReactNode } from "react";
import type { SecurityEventEntry } from "@devguard/shared";
import { destinationLabel, formatTime } from "../lib/format.js";
import { Button } from "./Button.js";
import { DataTable } from "./DataTable.js";
import { StatusBadge } from "./StatusBadge.js";

/**
 * Events as the hook reported them. The wording is deliberate: an event shows that DevGuard saw a push attempt and what it
 * decided. It does not show that data left the laptop or stayed on it, and pushes that skip the hook leave no event.
 * Outcome, exception and would-block are reported by the agent, not verified by the server.
 */
export function EventTable({ events }: { events: readonly SecurityEventEntry[] }): ReactNode {
  const [open, setOpen] = useState<string | undefined>(undefined);
  const selected = events.find((e) => e.id === open);
  return (
    <div className="space-y-3">
      <DataTable
        rows={events}
        rowKey={(e) => e.id}
        columns={[
          { header: "When", cell: (e) => formatTime(e.occurredAt) },
          { header: "Who", cell: (e) => `${e.userName} (${e.deviceName})` },
          { header: "Project", cell: (e) => e.projectName ?? "-" },
          { header: "Destination", cell: (e) => destinationLabel(e.destination) },
          { header: "Decision", cell: (e) => <StatusBadge value={e.outcome} /> },
          { header: "Rules", cell: (e) => (e.ruleIds.length === 0 ? "-" : e.ruleIds.join(", ")) },
          {
            header: "",
            cell: (e) => (
              <Button variant="secondary" onClick={() => setOpen(open === e.id ? undefined : e.id)}>
                {open === e.id ? "Hide" : "Details"}
              </Button>
            ),
          },
        ]}
      />
      {selected === undefined ? null : <EventDetail event={selected} />}
    </div>
  );
}

function EventDetail({ event }: { event: SecurityEventEntry }): ReactNode {
  const rows: [string, ReactNode][] = [
    ["Reference", event.correlationId],
    ["Operation", event.operation.replaceAll("_", " ")],
    ["Refs", event.refs.length === 0 ? "-" : event.refs.join(", ")],
    ["Mode", event.mode ?? "-"],
    ["Would be blocked in enforce mode", event.wouldBlock ? "yes" : "no"],
    ["Policy version", event.policyVersion ?? "-"],
    ["Exception", event.exceptionId ?? "-"],
    ["Agent version", event.agentVersion || "-"],
    ["Received", formatTime(event.receivedAt)],
  ];
  return (
    <section aria-label="Event details" className="rounded-lg bg-white p-4 text-sm ring-1 ring-slate-200">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-56 shrink-0 text-slate-500">{k}</dt>
            <dd className="break-all">{v}</dd>
          </div>
        ))}
      </dl>
      {event.findings.length === 0 ? null : (
        <div className="mt-3">
          <p className="font-medium">Findings (rule, kind and location only; DevGuard never sends file contents or secret values)</p>
          <ul className="mt-1 list-disc pl-5">
            {event.findings.map((f, i) => (
              <li key={`${f.ruleId}-${f.path}-${i}`}>
                {f.kind.replaceAll("_", " ")}: {f.ruleId} in {f.path}
                {f.line === undefined ? "" : `:${f.line}`}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">This record shows what the DevGuard hook observed and decided on this push attempt. It does not prove whether any data left or stayed on the device, and decision fields are reported by the agent.</p>
    </section>
  );
}
