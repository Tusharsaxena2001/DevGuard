import { useState, type ReactNode } from "react";
import { applyTheme, readThemePref, saveThemePref, type ThemePref } from "../lib/theme.js";
import { Button } from "./Button.js";

const NEXT: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<ThemePref, string> = { system: "System", light: "Light", dark: "Dark" };

/** Cycles System -> Light -> Dark. The choice is remembered in this browser only. */
export function ThemeToggle({ className = "" }: { className?: string }): ReactNode {
  const [pref, setPref] = useState<ThemePref>(readThemePref);
  const change = (): void => {
    const next = NEXT[pref];
    saveThemePref(next);
    applyTheme(next);
    setPref(next);
  };
  return (
    <Button variant="secondary" className={className} onClick={change} aria-label={`Colour theme: ${LABEL[pref]}. Switch to ${LABEL[NEXT[pref]]}.`}>
      Theme: {LABEL[pref]}
    </Button>
  );
}
