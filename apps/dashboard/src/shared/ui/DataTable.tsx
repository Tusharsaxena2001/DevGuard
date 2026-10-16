import type { ReactNode } from "react";

export interface Column<T> {
  readonly header: string;
  readonly cell: (row: T) => ReactNode;
}

/** Presentational table. Loading, empty and error states are the caller's job (see QueryBoundary). */
export function DataTable<T>({ columns, rows, rowKey }: { columns: readonly Column<T>[]; rows: readonly T[]; rowKey: (row: T) => string }): ReactNode {
  return (
    <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className="px-3 py-2 font-medium">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="align-top">
              {columns.map((c) => (
                <td key={c.header} className="px-3 py-2">
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
