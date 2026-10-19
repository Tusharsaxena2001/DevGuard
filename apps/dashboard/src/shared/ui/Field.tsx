import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

// 16px text below `md` keeps iOS from zooming the page when a field is focused; 44px high for touch.
const CONTROL = "mt-1 block min-h-11 w-full rounded-md border-0 bg-white px-2.5 py-2 text-base ring-1 ring-slate-300 focus:ring-2 focus:ring-slate-900 lg:min-h-9 lg:py-1.5 lg:text-sm";
const INVALID = "ring-red-600 focus:ring-red-600";

interface Common {
  label: string;
  /** Message for this field. Shown under it and tied to it with `aria-describedby`. */
  error?: string | undefined;
}

/** The message sits outside the `<label>` so it does not become part of the field's name; `aria-describedby` ties it to the field. */
function Shell({ label, error, id, children }: Common & { id: string; children: ReactNode }): ReactNode {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">
        {label}
        {children}
      </label>
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

const describe = (id: string, error: string | undefined): { "aria-invalid"?: true; "aria-describedby"?: string } =>
  error === undefined ? {} : { "aria-invalid": true, "aria-describedby": `${id}-error` };

export function TextField({ label, error, ...rest }: Common & InputHTMLAttributes<HTMLInputElement>): ReactNode {
  const id = useId();
  return (
    <Shell label={label} error={error} id={id}>
      <input {...rest} {...describe(id, error)} className={`${CONTROL} ${error === undefined ? "" : INVALID}`} />
    </Shell>
  );
}

export function TextArea({ label, error, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>): ReactNode {
  const id = useId();
  return (
    <Shell label={label} error={error} id={id}>
      <textarea {...rest} {...describe(id, error)} className={`${CONTROL} ${error === undefined ? "" : INVALID}`} rows={3} />
    </Shell>
  );
}

export function SelectField({ label, error, children, ...rest }: Common & { children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>): ReactNode {
  const id = useId();
  return (
    <Shell label={label} error={error} id={id}>
      <select {...rest} {...describe(id, error)} className={`${CONTROL} ${error === undefined ? "" : INVALID}`}>
        {children}
      </select>
    </Shell>
  );
}
