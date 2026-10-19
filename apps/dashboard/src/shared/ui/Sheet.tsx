import { useId, useRef, type ReactNode } from "react";
import { Button } from "./Button.js";
import { useFocusTrap } from "./useFocusTrap.js";

/** A bottom sheet for details on small screens: focus stays inside, Escape or the backdrop closes, focus returns to the trigger. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): ReactNode {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(panel, true, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <button type="button" tabIndex={-1} aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl ring-1 ring-slate-200">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
