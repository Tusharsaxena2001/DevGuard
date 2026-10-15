/** User-facing output. `info` goes to stdout, `error` to stderr. Callers never pass secrets. */
export interface Logger {
  info(message: string): void;
  error(message: string): void;
}
