# ADR-015: A deliberately minimal dashboard (admin-only, hand-rolled components)

**Status:** accepted
**Context:** UI-1..UI-7. The product is being validated as an idea, so the dashboard has to be correct and honest, not polished.

## Decisions
1. **Security admins only** (ADR-014). A signed-in non-admin sees one explanatory page and the dashboard makes no admin calls for them. Hiding pages is convenience; every call is still authorised by the API.
2. **Same-origin proxy.** The dashboard dev/preview server proxies `/v1` to the API (`DEVGUARD_API_URL`), so the httpOnly `SameSite=Lax` session cookie needs no CORS and no token ever touches JavaScript or storage. A production deployment must serve the built files and the API from one origin (or a reverse proxy) and add CSP, `frame-ancestors 'none'` and `X-Content-Type-Options` headers, which a static Vite build cannot set itself.
3. **Small hand-written components instead of the shadcn/ui CLI.** `shared/ui` holds a handful of Tailwind components (button, fields, table, loading/empty/error states, pagination). They follow the same shape as shadcn components, so adopting shadcn later is a swap, not a rewrite. Fewer dependencies for a hackathon build.
4. **Every response is validated.** The only `fetch` is in `shared/lib/api-client.ts`, and every success body is parsed with a Zod schema from `@devguard/shared`; a mismatch is an error state, not a half-rendered screen. Lint enforces: no `fetch` elsewhere, features never import each other, nothing imports `policy-engine`, `api` or `agent`.
5. **Server state only through TanStack Query hooks in `features/*/api`.** A 401 anywhere marks the session gone (back to login); signing out or in drops everything cached for the previous person; the one-time enrollment token is shown once and discarded when the page is left.
6. **Honest wording.** Events and numbers say they show what the hook observed and decided, that decision fields are reported by the agent, and that pushes that skip the hook leave no event.

## Update 2026-10-19: responsive layout, dark mode and accessibility are now in scope
A mobile audit (`docs/testing/ui-audit.md`) found the desktop-first layout unusable on phones and tablets, so decisions 3 and "not built" are amended:
- **Responsive:** below 1024px (`lg`) the shell is a top bar with a drawer menu and tables become card lists; from 1024px it is a sticky sidebar and real tables. Touch targets are at least 44px below 1024px. No page-level horizontal scroll at 360px and up.
- **Dark mode:** light, dark and system, chosen with a toggle and remembered per browser. It is implemented by remapping the Tailwind neutral and status colour variables in `src/index.css` (design tokens), so components carry no `dark:` classes. Text keeps at least 4.5:1 contrast in both themes.
- **Accessibility basics:** skip link, a title per page, focus moved to the page heading after navigation, focus-trapped drawer, dialogs and sheets, per-field error messages, a visible focus ring.
- Components are still hand-written (no shadcn CLI, no new runtime dependency).

## Not built
UI-8 (notifications and alert settings, needs API-8), employee self-service views, charts (numbers and tables only), pagination beyond simple page controls, and an in-app policy diff.
