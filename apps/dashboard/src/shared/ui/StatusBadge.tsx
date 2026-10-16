import type { ReactNode } from "react";

const TONES: Record<string, string> = {
  allowed: "bg-emerald-100 text-emerald-800",
  approved: "bg-emerald-100 text-emerald-800",
  active: "bg-emerald-100 text-emerald-800",
  blocked: "bg-red-100 text-red-800",
  rejected: "bg-red-100 text-red-800",
  revoked: "bg-red-100 text-red-800",
  error: "bg-amber-100 text-amber-800",
  pending: "bg-amber-100 text-amber-800",
  stale: "bg-amber-100 text-amber-800",
  exception: "bg-sky-100 text-sky-800",
  expired: "bg-slate-200 text-slate-700",
  disabled: "bg-slate-200 text-slate-700",
};

/** A small coloured word. Unknown values are neutral, never an error. */
export function StatusBadge({ value }: { value: string }): ReactNode {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONES[value] ?? "bg-slate-100 text-slate-700"}`}>{value.replaceAll("_", " ")}</span>;
}
