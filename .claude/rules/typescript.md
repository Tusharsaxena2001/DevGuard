# TypeScript rules

- `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` from `packages/config`. No `any` (use `unknown` + Zod parse). No `@ts-ignore`/`@ts-expect-error` to silence real errors; if unavoidable, justify in a comment.
- Validate every external boundary (HTTP bodies, query params, env, CLI input, git output parsed into structures, files read from disk) with Zod schemas from `packages/shared`. Infer types with `z.infer`.
- Errors: use typed error classes with stable `code` strings. Do not throw strings. Error messages shown to users must be actionable and must not include secrets, tokens, file contents or Authorization data.
- Security-critical parsing (URLs, policies, hook input) returns a discriminated result (`{ ok: true, ... } | { ok: false, reason }`) rather than throwing, and callers must handle `ok: false` as deny.
- Prefer named exports, small pure functions, explicit return types on exported functions.
- ESM modules, Node >= 22. No default exports except where a framework requires them.
- Match surrounding style (2-space indent, double quotes, as in neighbouring files). ESLint is the only enforced tool; there is no Prettier setup.
- Time and randomness are injected in domain code (`now: Date`) for deterministic tests.
