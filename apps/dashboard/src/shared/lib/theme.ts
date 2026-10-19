export type ThemePref = "system" | "light" | "dark";

const KEY = "devguard.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Browser storage can be missing or throw (private windows, blocked site data): the page must work without it. */
export function readThemePref(): ThemePref {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function saveThemePref(pref: ThemePref): void {
  try {
    if (pref === "system") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, pref);
  } catch {
    // Not remembered; the choice still applies to this page view.
  }
}

export function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function applyTheme(pref: ThemePref): void {
  document.documentElement.dataset["theme"] = resolveTheme(pref);
}

/** Call once before rendering. Follows the operating system while the preference is "system". */
export function initTheme(): void {
  applyTheme(readThemePref());
  if (typeof window.matchMedia !== "function") return;
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    if (readThemePref() === "system") applyTheme("system");
  });
}
