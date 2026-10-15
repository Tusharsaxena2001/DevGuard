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
