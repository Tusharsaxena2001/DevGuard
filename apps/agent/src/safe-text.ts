const MAX_TEXT = 200;

/**
 * Text from a repository, Git config or the environment (paths, ref names, URLs) may contain control characters or
 * Unicode that reorders or hides text. Never let it reach a terminal as-is: replace C0/C1 controls, bidi overrides and
 * isolates, zero-width marks and line separators, and cap the length.
 */
export function safeText(text: string): string {
  const cleaned = text.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, "?");
  return cleaned.length > MAX_TEXT ? `${cleaned.slice(0, MAX_TEXT)}...` : cleaned;
}
