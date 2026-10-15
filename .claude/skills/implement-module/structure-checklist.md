# Structure checklist (run before calling a module done)

Source of truth: `docs/architecture/engineering-standards.md`.

- [ ] Each file has one responsibility; none is a grab-bag. Files > ~250 lines or functions > ~40 lines are justified or split.
- [ ] Entry points are thin: controller / CLI command / React page only parse, delegate to one use case, and shape output.
- [ ] **API:** controller -> service -> repository. Prisma used only in repositories. Services call other services, not other repositories. Module exports only its service. Audit written in the same transaction.
- [ ] **Agent:** `cli/` has no logic; use cases depend on `ports/`; Git only via `GitPort`; the pre-push runner does not import commander; composition happens only in `main.ts`.
- [ ] **Dashboard:** no `fetch` in components; server state through query hooks in `features/*/api`; no feature imports another feature; no business or security rules in components.
- [ ] Dependencies are injected (no module-level DB/HTTP clients, no direct clock calls in logic).
- [ ] Pure logic is separate from I/O and tested without mocks of I/O.
- [ ] Names say what things do; comments explain why. No dead code, no speculative abstractions, no empty directories.
- [ ] Errors are typed with stable `ErrorCode`s and mapped to HTTP/exit codes only at the edge.
- [ ] ESLint import-boundary rules (where the app skeleton defines them) pass.
