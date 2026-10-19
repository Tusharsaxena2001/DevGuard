import { Fragment, type ReactNode } from "react";
import { useIsDesktop } from "../lib/useMediaQuery.js";

export interface Column<T> {
  /** Empty for an actions column (buttons): it is named "Actions" for assistive technology. */
  readonly header: string;
  readonly cell: (row: T) => ReactNode;
  /** Keep the value on one line (dates), so rows stay compact. */
  readonly nowrap?: boolean;
  /** The heading of each card on small screens. Defaults to the first column. */
  readonly primary?: boolean;
}

/**
 * Presentational list. From `lg` (1024px) up it is a real table; below that, each row becomes a card (heading, label/value pairs,
 * then the action buttons), because a 7-column table cannot be read on a phone. Loading, empty and error states are the
 * caller's job (see QueryBoundary).
 */
export function DataTable<T>({ columns, rows, rowKey, label }: { columns: readonly Column<T>[]; rows: readonly T[]; rowKey: (row: T) => string; label?: string }): ReactNode {
  return useIsDesktop() ? <Table columns={columns} rows={rows} rowKey={rowKey} label={label} /> : <Cards columns={columns} rows={rows} rowKey={rowKey} label={label} />;
}

interface Props<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  label: string | undefined;
}

// The scroll container is `relative` so the absolutely positioned `sr-only` header text is clipped here instead of widening the page.
function Table<T>({ columns, rows, rowKey, label }: Props<T>): ReactNode {
  return (
    <div className="relative max-w-full overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
      <table aria-label={label} className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {columns.map((c, i) => (
              <th key={`${c.header}-${i}`} scope="col" className="px-3 py-2 font-medium">
                {c.header === "" ? <span className="sr-only">Actions</span> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="align-top">
              {columns.map((c, i) => (
                <td key={`${c.header}-${i}`} className={`px-3 py-2 ${c.nowrap === true ? "whitespace-nowrap" : ""}`}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cards<T>({ columns, rows, rowKey, label }: Props<T>): ReactNode {
  const actions = columns.filter((c) => c.header === "");
  const fields = columns.filter((c) => c.header !== "");
  const title = fields.find((c) => c.primary === true) ?? fields[0];
  const details = fields.filter((c) => c !== title);
  return (
    <ul aria-label={label} className="space-y-3">
      {rows.map((row) => {
        const buttons = actions.map((c) => c.cell(row)).filter((node) => node !== null && node !== undefined && node !== false);
        return (
          <li key={rowKey(row)} className="rounded-lg bg-white p-4 text-sm ring-1 ring-slate-200">
            {title === undefined ? null : <div className="break-words text-base font-medium">{title.cell(row)}</div>}
            <dl className="mt-2 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              {details.map((c, i) => (
                <Fragment key={`${c.header}-${i}`}>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">{c.header}</dt>
                  <dd className="min-w-0 break-words">{c.cell(row)}</dd>
                </Fragment>
              ))}
            </dl>
            {buttons.length === 0 ? null : <div className="mt-3 flex flex-wrap gap-2">{buttons.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>}
          </li>
        );
      })}
    </ul>
  );
}
