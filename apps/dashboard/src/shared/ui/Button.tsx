import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger";

const STYLES: Record<Variant, string> = {
  primary: "bg-slate-900 text-white hover:bg-slate-700",
  secondary: "bg-white text-slate-900 ring-1 ring-slate-300 hover:bg-slate-100",
  danger: "bg-red-600 text-white hover:bg-red-500",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  busy?: boolean;
  children: ReactNode;
}

export function Button({ variant = "primary", busy = false, disabled, children, className = "", ...rest }: Props): ReactNode {
  return (
    <button
      {...rest}
      disabled={disabled === true || busy}
      className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-9 lg:px-3 lg:py-1.5 ${STYLES[variant]} ${className}`}
    >
      {busy ? "Working..." : children}
    </button>
  );
}
