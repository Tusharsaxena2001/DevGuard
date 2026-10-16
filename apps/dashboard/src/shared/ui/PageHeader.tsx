import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }): ReactNode {
  return (
    <header className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle === undefined ? null : <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}
