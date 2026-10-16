import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const CONTROL = "mt-1 block w-full rounded-md border-0 px-2.5 py-1.5 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-slate-900";

export function TextField({ label, ...rest }: { label: string } & InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input {...rest} className={CONTROL} />
    </label>
  );
}

export function TextArea({ label, ...rest }: { label: string } & TextareaHTMLAttributes<HTMLTextAreaElement>): ReactNode {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <textarea {...rest} className={CONTROL} rows={3} />
    </label>
  );
}

export function SelectField({ label, children, ...rest }: { label: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>): ReactNode {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select {...rest} className={CONTROL}>
        {children}
      </select>
    </label>
  );
}
