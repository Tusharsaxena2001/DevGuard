import { useId, useRef, type ReactNode } from "react";
import { Button } from "./Button.js";
import { useFocusTrap } from "./useFocusTrap.js";

/**
 * Accessible confirmation for destructive actions (replaces `window.confirm`). Focus starts on Cancel, Tab stays inside,
 * Escape and the backdrop cancel, and focus returns to the button that opened it.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactNode {
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useFocusTrap(panel, open, onCancel, cancel);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button type="button" tabIndex={-1} aria-label="Cancel" className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div ref={panel} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} className="relative w-full max-w-md rounded-t-xl bg-white p-5 shadow-xl ring-1 ring-slate-200 sm:rounded-xl">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div id={bodyId} className="mt-2 text-sm text-slate-600">
          {children}
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancel}
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-900 ring-1 ring-slate-300 hover:bg-slate-100 lg:min-h-9"
          >
            Cancel
          </button>
          <Button variant="danger" busy={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
