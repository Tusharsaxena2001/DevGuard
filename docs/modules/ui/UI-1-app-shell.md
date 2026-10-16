# UI-1 App shell (apps/dashboard)

**Responsibility:** Vite + React + Tailwind + shadcn/ui foundation, API client, auth, role-aware routing, shared UX patterns.
**Depends on:** API-2.

## Contract
- Router with protected routes; session from `GET /auth/me`; role-aware nav (visibility only — server enforces access); 401 => login, 403 => forbidden page.
- API client using shared Zod schemas; TanStack Query; shared `DataTable`, `StatusBadge`, `EmptyState`, `ErrorState`, `LoadingState`.
- No hardcoded production data; demo data comes from API seed.
## Structure (docs/architecture/engineering-standards.md)
`src/app/` (router, providers, guard, layout), `src/features/<feature>/{api,components,pages}`, `src/shared/{ui,lib}`. No `fetch` in components; features do not import each other; ESLint boundary rules defined in this module.
## Acceptance
Structure and boundaries above followed and enforced by lint; login/logout flow against real API; unauthorized redirect; build passes; states render in component tests.

## Implemented (apps/dashboard)
- **Stack:** Vite 8, React 19, React Router 7, TanStack Query 5, Tailwind 4; see ADR-015 for the choices (admin-only, hand-rolled components, same-origin proxy).
- **Auth and routing:** `GET /v1/auth/me` decides the screen. Signed out -> `/login`; signed in but not a security admin -> an explanation page (no admin calls are made); admin -> the shell with Overview, Events, Approvals, Projects, Devices, Audit. 401 on any call (session expired or revoked) sends the person to login; a wrong password is not mistaken for that. Sign-out and sign-in drop everything cached for the previous person.
- **Shared UX:** `QueryBoundary` renders loading, error (with retry) and empty states for every data view; `DataTable`, `StatusBadge`, `Pagination`, `EventTable`.
- **Structure and enforcement:** `src/app`, `src/features/<feature>/{api,pages,components}`, `src/shared/{ui,lib,api}`. ESLint: `fetch` only in `shared/lib/api-client.ts`; features do not import each other; only `@devguard/shared` may be imported from the packages. `test/boundaries.test.ts` proves the rules fire.
- **Run:** `DEVGUARD_API_URL=http://localhost:3000 pnpm --filter @devguard/dashboard dev` (http://localhost:5173) or `build` + `preview`.
- **Tests:** 73 (Vitest + Testing Library): the API client, routing and session flows (signed out, loading, error, employee, admin, login, wrong password, sign-out, mid-session 401, no data leak between people), every view's states and main interactions, boundaries.
- **Security review:** independent read-only review found no high issues (no `dangerouslySetInnerHTML`, no browser storage, no open redirects, text rendered as text). Fixed: a 401 mid-session, cached data across sign-ins, the enrollment token lingering in memory. Open: a production deployment needs CSP and frame headers from its host (ADR-015).
