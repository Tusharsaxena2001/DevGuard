/** Process exit codes of the `devguard` CLI. `blocked` is reserved for the pre-push runner. */
export const ExitCode = {
  ok: 0,
  blocked: 1,
  usageOrConfig: 2,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
