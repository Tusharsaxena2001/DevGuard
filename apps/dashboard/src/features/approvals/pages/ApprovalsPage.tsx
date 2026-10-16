import { useState, type FormEvent, type ReactNode } from "react";
import { ExceptionStatusSchema, type ExceptionEntry, type ExceptionStatus } from "@devguard/shared";
import { Button } from "../../../shared/ui/Button.js";
import { SelectField, TextArea, TextField } from "../../../shared/ui/Field.js";
import { PageHeader } from "../../../shared/ui/PageHeader.js";
import { Pagination } from "../../../shared/ui/Pagination.js";
import { QueryBoundary } from "../../../shared/ui/QueryBoundary.js";
import { Notice } from "../../../shared/ui/States.js";
import { StatusBadge } from "../../../shared/ui/StatusBadge.js";
import { describeError, destinationLabel, formatTime } from "../../../shared/lib/format.js";
import { useDecide, useExceptions } from "../api/exceptions.js";

const DEFAULT_HOURS = 24;
const toLocalInput = (date: Date): string => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function DecisionForm({ entry, me, onDone }: { entry: ExceptionEntry; me: string; onDone: () => void }): ReactNode {
  const decide = useDecide();
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState(toLocalInput(new Date(Date.now() + DEFAULT_HOURS * 3_600_000)));
  const ownRequest = entry.requesterId === me;
  const act = (kind: "approve" | "reject" | "revoke") => (event: FormEvent): void => {
    event.preventDefault();
    const base = { id: entry.id, reason };
    decide.mutate(kind === "approve" ? { ...base, kind, expiresAt: new Date(expires).toISOString() } : { ...base, kind }, { onSuccess: onDone });
  };
  const canApprove = entry.status === "pending";
  return (
    <form className="mt-3 space-y-3 rounded-md bg-slate-50 p-3" onSubmit={act(canApprove ? "approve" : "revoke")} aria-label={`Decide request ${entry.id}`}>
      {ownRequest && canApprove ? <Notice tone="error">This is your own request. Another administrator has to decide it (the server enforces this).</Notice> : null}
      <TextArea label="Reason (shown to the requester and kept in the history)" required minLength={10} value={reason} onChange={(e) => setReason(e.target.value)} />
      {canApprove ? <TextField label="Valid until" type="datetime-local" required value={expires} onChange={(e) => setExpires(e.target.value)} /> : null}
      <div className="flex flex-wrap gap-2">
        {canApprove ? (
          <>
            <Button type="submit" busy={decide.isPending} disabled={ownRequest}>
              Approve
            </Button>
            <Button type="button" variant="danger" disabled={ownRequest || decide.isPending} onClick={act("reject")}>
              Reject
            </Button>
          </>
        ) : (
          <Button type="submit" variant="danger" busy={decide.isPending}>
            Revoke approval
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {decide.isError ? <Notice tone="error">{describeError(decide.error)}</Notice> : null}
    </form>
  );
}

function Request({ entry, me }: { entry: ExceptionEntry; me: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const decidable = entry.status === "pending" || entry.status === "approved";
  return (
    <li className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {entry.requesterName} wants {entry.projectName} to push to {destinationLabel(entry.destination)}
        </p>
        <StatusBadge value={entry.status} />
      </div>
      <p className="mt-1 text-sm text-slate-600">Reason: {entry.reason}</p>
      <p className="mt-1 text-xs text-slate-500">
        Requested {formatTime(entry.createdAt)}
        {entry.expiresAt === null ? "" : ` - approved until ${formatTime(entry.expiresAt)}`}. It covers this one project and destination only; secrets and prohibited files are still checked.
      </p>
      {entry.decisions.length === 0 ? null : (
        <ul className="mt-2 space-y-1 text-sm">
          {entry.decisions.map((d) => (
            <li key={d.decidedAt + d.decision}>
              {d.decision} by {d.deciderName} on {formatTime(d.decidedAt)}: {d.reason}
            </li>
          ))}
        </ul>
      )}
      {decidable && !open ? (
        <Button className="mt-3" variant="secondary" onClick={() => setOpen(true)}>
          {entry.status === "pending" ? "Review" : "Revoke..."}
        </Button>
      ) : null}
      {open ? <DecisionForm entry={entry} me={me} onDone={() => setOpen(false)} /> : null}
    </li>
  );
}

export function ApprovalsPage({ me }: { me: string }): ReactNode {
  const [status, setStatus] = useState<ExceptionStatus | "">("pending");
  const [page, setPage] = useState(1);
  const query = useExceptions(status === "" ? undefined : status, page);
  return (
    <>
      <PageHeader title="Approvals" subtitle="Requests to push a project to a destination that is not approved. Each one is scoped to one project and one destination, and expires." />
      <div className="mb-4 w-56">
        <SelectField label="Show" value={status} onChange={(e) => (setStatus(e.target.value === "" ? "" : ExceptionStatusSchema.parse(e.target.value)), setPage(1))}>
          <option value="">All requests</option>
          {ExceptionStatusSchema.options.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </SelectField>
      </div>
      <QueryBoundary query={query} isEmpty={(d) => d.items.length === 0} emptyTitle="Nothing to review" emptyHint="Requests appear when a developer asks for an exception after a blocked push.">
        {(data) => (
          <div className="space-y-3">
            <ul className="space-y-3">
              {data.items.map((e) => (
                <Request key={e.id} entry={e} me={me} />
              ))}
            </ul>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
