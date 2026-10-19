# UI-1 App shell (apps/dashboard)

**Responsibility:** Vite + React + Tailwind foundation (hand-written components, ADR-015), API client, auth, role-aware routing, shared UX patterns.
**Depends on:** API-2.

## Contract
- Router with protected routes; session from `GET /auth/me`; role-aware nav (visibility only — server enforces access); 401 => login, 403 => forbidden page.
- API client using shared Zod schemas; TanStack Query; shared `DataTable`, `StatusBadge`, `EmptyState`, `ErrorState`, `LoadingState`.
- No hardcoded production data; demo data comes from API seed.
- **Responsive and accessible (acceptance, see `docs/testing/ui-audit.md`):** no page-level horizontal scroll from 360px up; below 1024px a drawer menu and card lists instead of wide tables, from 1024px a sticky sidebar and tables; touch targets >= 44px below 1024px; light/dark/system theme with >= 4.5:1 text contrast in both; skip link, per-route title, focus to the page heading after navigation, focus trap and Escape for the drawer, dialogs and sheets; destructive actions use an accessible confirm dialog (never `window.confirm`); field errors are tied to their field with `aria-describedby`.
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
- **Responsive pass (2026-10-19):** `DataTable` renders a table from 1024px and cards below it; `Layout` has the drawer, skip link, title and focus handling; `ConfirmDialog`, `Sheet` (event details on small screens), `CopyButton`, `FilterPanel`, `ThemeToggle`, per-field errors, skeleton loading; design tokens and dark mode in `src/index.css`. Findings, measurements and the fixes: `docs/testing/ui-audit.md`.
- **Tests:** 94 (Vitest + Testing Library; the earlier 73 plus responsive/accessibility behaviour, with the 1024px breakpoint simulated through `matchMedia`): the API client, routing and session flows (signed out, loading, error, employee, admin, login, wrong password, sign-out, mid-session 401, no data leak between people), every view's states and main interactions, boundaries.
- **Security review:** independent read-only review found no high issues (no `dangerouslySetInnerHTML`, no browser storage, no open redirects, text rendered as text). Fixed: a 401 mid-session, cached data across sign-ins, the enrollment token lingering in memory. Open: a production deployment needs CSP and frame headers from its host (ADR-015).
