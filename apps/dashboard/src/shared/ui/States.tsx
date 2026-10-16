import type { ReactNode } from "react";
import { Button } from "./Button.js";

export function LoadingState({ label = "Loading..." }: { label?: string }): ReactNode {
  return (
    <div role="status" className="rounded-lg bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200">
      {label}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }): ReactNode {
  return (
    <div className="rounded-lg bg-white p-8 text-center ring-1 ring-slate-200">
      <p className="font-medium text-slate-700">{title}</p>
      {hint === undefined ? null : <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): ReactNode {
  return (
    <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
      <p>{message}</p>
      {onRetry === undefined ? null : (
        <Button variant="secondary" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Inline result of an action (saved, failed). */
export function Notice({ tone, children }: { tone: "error" | "success"; children: ReactNode }): ReactNode {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-md px-3 py-2 text-sm ${tone === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>
      {children}
    </p>
  );
}
