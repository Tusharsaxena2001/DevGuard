import type { ReactNode } from "react";

/** The page `h1` is focusable so the shell can move focus to it after navigation (screen-reader and keyboard users). */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }): ReactNode {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 tabIndex={-1} className="text-xl font-semibold">
          {title}
        </h1>
        {subtitle === undefined ? null : <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}
