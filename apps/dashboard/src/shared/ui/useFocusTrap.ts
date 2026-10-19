import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * While `active`: moves focus into `container`, keeps Tab inside it, calls `onEscape` on Escape, and puts focus back where it
 * was when the trap ends. Used by the mobile navigation drawer and the confirm dialog.
 */
export function useFocusTrap(container: RefObject<HTMLElement | null>, active: boolean, onEscape: () => void, initialFocus?: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return;
    const root = container.current;
    if (root === null) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.closest("[hidden],[inert],[aria-hidden=true]") === null);
    (initialFocus?.current ?? items()[0] ?? root).focus();

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const list = items();
      const first = list[0];
      const last = list[list.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!root.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus();
    };
    // `onEscape` is intentionally not a dependency: callers pass a fresh closure each render and the trap must not restart.
  }, [active, container, initialFocus]);
}
