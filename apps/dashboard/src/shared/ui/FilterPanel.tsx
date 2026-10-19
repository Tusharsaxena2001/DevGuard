import { useId, useState, type ReactNode } from "react";

/** Filters take much of a phone screen, so below `md` they sit behind a toggle that shows how many are active. */
export function FilterPanel({ activeCount, children }: { activeCount: number; children: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="mb-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-11 w-full items-center justify-between rounded-md bg-white px-4 py-2 text-sm font-medium ring-1 ring-slate-300 lg:hidden"
      >
        <span>Filters{activeCount > 0 ? ` (${activeCount} active)` : ""}</span>
        <span aria-hidden="true">{open ? "Hide" : "Show"}</span>
      </button>
      <div id={id} className={`${open ? "mt-3 block" : "hidden"} lg:mt-0 lg:block`}>
        {children}
      </div>
    </div>
  );
}
