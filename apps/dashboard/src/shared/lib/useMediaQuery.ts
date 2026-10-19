import { useSyncExternalStore } from "react";

/** Subscribes to a CSS media query. Where `matchMedia` does not exist (tests, very old browsers) it answers `fallback`. */
export function useMediaQuery(query: string, fallback: boolean): boolean {
  const subscribe = (notify: () => void): (() => void) => {
    if (typeof window.matchMedia !== "function") return () => undefined;
    const list = window.matchMedia(query);
    list.addEventListener("change", notify);
    return () => list.removeEventListener("change", notify);
  };
  const snapshot = (): boolean => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback);
  return useSyncExternalStore(subscribe, snapshot, () => fallback);
}

/** `lg` (1024px) and up in Tailwind: the sidebar layout and real tables. Below it: drawer navigation and card lists. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)", true);
}
