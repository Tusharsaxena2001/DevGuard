/** Discriminated result for security-critical parsing: callers must handle `ok: false` as deny. */
export type Result<T, R extends string> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: R };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
export const fail = <R extends string>(reason: R): { ok: false; reason: R } => ({ ok: false, reason });
