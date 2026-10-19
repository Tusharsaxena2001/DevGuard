import { useEffect, useState, type ReactNode } from "react";
import { Button } from "./Button.js";

type State = "idle" | "copied" | "failed";

/** Copies `text` and says so in a live region. If the browser refuses (no permission, insecure origin) it says to copy by hand. */
export function CopyButton({ text, label }: { text: string; label: string }): ReactNode {
  const [state, setState] = useState<State>("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 3000);
    return () => window.clearTimeout(timer);
  }, [state]);
  const copy = (): void => {
    const write = typeof navigator.clipboard?.writeText === "function" ? navigator.clipboard.writeText(text) : Promise.reject(new Error("clipboard unavailable"));
    write.then(
      () => setState("copied"),
      () => setState("failed"),
    );
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="secondary" onClick={copy}>
        {label}
      </Button>
      <span role="status" className="text-sm text-slate-600">
        {state === "copied" ? "Copied." : state === "failed" ? "Could not copy automatically: select the text and copy it." : ""}
      </span>
    </span>
  );
}
