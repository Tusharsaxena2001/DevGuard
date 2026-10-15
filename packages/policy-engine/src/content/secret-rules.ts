export interface SecretRule {
  readonly id: string;
  /** Boolean only: the matched text must never leave this function. */
  readonly matches: (text: string) => boolean;
}

function rule(id: string, pattern: RegExp): SecretRule {
  // Patterns are non-global so `test` carries no lastIndex state between lines.
  return { id, matches: (text) => pattern.test(text) };
}

/**
 * Minimal high-confidence detector (ADR-005). Not comprehensive: no entropy checks, passwords, binary files or
 * obfuscated secrets. Every pattern is a fixed prefix plus bounded character class, so matching is linear time.
 */
export const SECRET_RULES: readonly SecretRule[] = [
  rule("private_key_block", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/),
  rule("aws_access_key_id", /(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Z0-9])/),
  rule("github_token", /gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,}/),
  rule("slack_token", /xox[baprs]-[A-Za-z0-9-]{10,}/),
  rule(
    "provider_token",
    /[sr]k_live_[A-Za-z0-9]{24,}|AIza[A-Za-z0-9_-]{35}|npm_[A-Za-z0-9]{36}|glpat-[A-Za-z0-9_-]{20,}|SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/,
  ),
];

export const DEFAULT_SECRET_RULE_IDS: readonly string[] = SECRET_RULES.map((r) => r.id);
