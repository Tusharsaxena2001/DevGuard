# Dashboard responsive and UX audit

Date: 2026-10-19. Method: the Playwright MCP drove system Chrome against `scripts/e2e-demo.sh --keep` (seeded API + Vite dev server, synthetic data only) as `admin@example.test`. Viewports: 360x640, 390x844, 768x1024, 1280x800 and a landscape phone 844x390. A measuring script ran on every route (`/`, `/events`, `/approvals`, `/projects`, a project page, `/devices`, `/audit`, a 404): page-level horizontal overflow, elements outside the viewport, horizontally scrolling containers, tap-target size (< 44px), text under 12px, focus outlines, landmarks and headings. Screenshots were reviewed for Events, Project, Devices (token) and Audit.

Not verified: the visual error state (a failed request showed cached data, so it was inconclusive; the component tests cover it), real touch devices, screen readers, Safari/Firefox. The headless browser uses 15px classic scrollbars, so reported widths are about 15px narrower than on a phone.

Severity: **blocker** (content unreachable or layout broken), **major** (hard to use), **minor** (polish).

## Findings

| ID | Where | Viewport | Sev | Finding | Fix |
|----|-------|----------|-----|---------|-----|
| R1 | `/`, `/events`, `/audit` (any wide table) | 768 | blocker | The page itself scrolls sideways: `main` is 942-952px wide in a 768px window and the sidebar is squeezed to 122px. The table container does not constrain its flex parent, so the table pushes the layout wider than the screen. | `min-w-0` on the main column so the table's own scroll container does the scrolling; verify no page overflow. |
| R2 | all table pages (Overview recent, Events, Audit, Devices, Projects detail version history) | 360-768 | blocker | Tables scroll inside a box (888px in 343px on Events; 737 Audit; 555 Devices; 878 Overview). Decision, project, destination and the Details button are off-screen; cells wrap into ~150px-tall rows ("Oct 19, 2026, 5:18 PM" on five lines). No scroll hint. | Stacked card layout below `md` (label/value pairs, action at the bottom) from the shared `DataTable`; real table from `md` up; no wrapping dates (`whitespace-nowrap` for date/ids). |
| R3 | App shell nav | 360-768 | major | The mobile nav is a horizontally scrolling strip (471px in 313-358px): "Audit" is cut off or hidden, with no hint that it scrolls. The active pill is half cut off on Devices/Audit. | Menu button + slide-over drawer (focus trap, Escape, `aria-expanded`). |
| R4 | all pages | landscape phone 844x390 | major | Page overflows horizontally (same cause as R1). The sidebar is `static` and 2270-2733px tall, so navigation scrolls away with the content on every long page (also at 1280). | Sticky/fixed sidebar (own scroll), `min-w-0` main. |
| T1 | nav links, Sign out, every Button, inputs, selects, pagination | all touch sizes | major | Targets are 32-33px high (nav links 59-89x32; Details 69x32; Previous/Next 55-80x32; inputs 32px). Project page: member checkboxes are 13x13 and "All projects" link is 19px high; the project list links (`payments-service`) are 19px high. | 44px minimum on touch sizes (Button, links, inputs, selects, checkbox rows as full-row labels). |
| T2 | Devices "Enroll a laptop" | 390 | minor | The person select is truncated ("Seed Employee Bob (bob") and shares a row with the button. | Stack select and button on mobile; full-width. |
| U1 | Devices, token panel | all | major | The one-time enrollment token has no Copy button, and the command shown still contains `<token>` and `<this server>` placeholders. Easy to copy the wrong thing, or lose the token. | Copy button with "Copied" announcement; ready-to-paste command with the real server URL and the token filled in. |
| U2 | Devices, Revoke | all | major | Revoke uses `window.confirm` (native, unstyled, awkward on mobile, not testable). | Accessible `ConfirmDialog` naming the device and owner; destructive styling. |
| U3 | Events, Audit filters | 390 | minor | Filters take a third of the first screen before any result. | Collapsible filter panel on mobile with active-filter count. |
| U4 | Events detail | 390 | major (follows R2) | Detail opens as a panel below a long table; the "Details" button is off-screen. | Card layout makes the action reachable; detail as a full-width section/sheet. |
| U5 | Forms | all | minor | Validation relies on native browser bubbles; no per-field message, no `aria-invalid`/`aria-describedby`. | Field-level errors. |
| U6 | Loading | all | minor | Loading is plain text. | Skeleton rows/cards. |
| U7 | Login | 390 | minor | Large top margin; inputs and button 32px. | Smaller margin on mobile, 44px controls. |
| A1 | all | all | major | No skip-to-content link. Document title is "DevGuard" on every route, so route changes are not announced or distinguishable in history/tabs. Focus is not moved on route change. | Skip link; per-route `document.title`; focus the page heading on navigation. |
| A2 | Devices table | all | minor | One empty `<th>` (action column) has no accessible name; no table has a `<caption>`/label. | Visually-hidden "Actions" header; `aria-label` per table. |
| A3 | all | all | minor | Focus uses the browser default outline only (present on all 14 sampled controls, but low-contrast on dark buttons). | Explicit `focus-visible` ring from design tokens. |
| V1 | all | all | minor | Light theme only (`color-scheme: light`, no `dark:`); no design tokens, so colours are hard-coded slate/amber/emerald. | Tokens + dark mode (user chose polish in scope; supersedes ADR-015 "no dark mode"). |

## Verified fine (no change needed)
- 1280px: no page overflow on any route; sidebar layout works.
- No page-level overflow at 360 and 390 (the tables scroll inside their own box).
- Viewport meta, `lang="en"`, one `h1` per page, a `main` landmark, a labelled `nav`, no text under 12px.
- Project detail page is mostly usable on a phone (single column, forms fit) apart from T1 and the version-history table.
- Pages are readable at 360px without zooming.

## UX improvement list (beyond fixes)
1. Show decision and destination first in each event card; relative time ("2 h ago") with the exact time on tap.
2. Empty states with a next action (for example "No pending requests" -> link to Events).
3. Consistent page header with wrapping actions; consistent spacing scale.
4. Status badges keep text + colour; verify contrast in both themes.
5. Toggle for theme (light/dark/system), remembered per browser.

## Fix status and re-verification (same day)

Re-measured in the browser with the same scripts at 360, 390, 768, 844x390, 1024 and 1280, in light and dark.

| ID | Status | How it was fixed / what was measured |
|----|--------|--------------------------------------|
| R1 | Fixed | `min-w-0` on the main column. Re-check at 768: no page-level overflow on any route. A second cause turned up while verifying: the visually hidden "Actions" header (`position: absolute`) escaped the table's clipping and widened the page; the scroll container is now `relative`. |
| R2 | Fixed | `DataTable` renders cards below 1024px (heading, label/value pairs, buttons last) and a table from 1024px. At 360, 390 and 768: zero horizontally scrolling containers on every route. |
| R3 | Fixed | Menu button + drawer (focus moves in, Tab stays inside, Escape or a tap outside closes, focus returns to the button; the closed drawer is `inert`). |
| R4 | Fixed | Sticky top bar below 1024px, sticky full-height sidebar from 1024px. Landscape phone 844x390: no overflow, header stays at the top while scrolling. |
| T1 | Fixed | 44px controls below 1024px. Re-check at 360, 390, 768 and 844x390: 0 targets under 44px on every route. Exception: on the project page the member checkbox *input* is 20px; its whole row (44px high) is the tap target. |
| T2 | Fixed | Select and button stack on small screens. |
| U1 | Fixed | Token panel has Copy token and Copy command ("Copied." is announced); the command contains the real token and server address. |
| U2 | Fixed | `ConfirmDialog` names the device, focus starts on Cancel, Escape cancels; verified nothing is revoked on cancel. |
| U3 | Fixed | Filters collapse behind a toggle below 1024px, with an active-filter count. |
| U4 | Fixed | Details opens as a bottom sheet on small screens (inline from 1024px). |
| U5 | Partly fixed | Per-field messages with `aria-invalid`/`aria-describedby` on Add a person. The login form and the other forms still use the browser's built-in required-field messages. |
| U6 | Fixed | Skeleton placeholders with a hidden "Loading..." for assistive technology. |
| U7 | Fixed | Smaller top margin and 44px controls. |
| A1 | Fixed | Skip link, per-route title ("Events - DevGuard"), focus to the page heading after navigation. |
| A2 | Fixed | Hidden "Actions" header, an accessible name on every table/list. |
| A3 | Fixed | One explicit `focus-visible` ring from the tokens. |
| V1 | Fixed | Tokens and dark mode (System/Light/Dark toggle, remembered per browser). Contrast scan of all text on 7 pages in each theme: 0 elements below 4.5:1. |

## Still open (minor)
- At exactly 1024-1100px wide, three tables (Overview recent events, Events, Audit) still scroll about 100px sideways inside their own box (the page itself does not scroll). Cards below 1024px and a table from 1280px both fit.
- The login and other forms still rely on native required-field validation (U5).
- Not verified: real touch devices and screen readers, Safari and Firefox, and the visual error state (covered by component tests).
- Production hosting still needs TLS in front of the dashboard (see `docs/architecture/security-model.md`).
- Expected console message on the nginx-served build: "Note that 'script-src' was not explicitly set, so 'default-src' is used as a fallback". Zod probes whether `Function("")` is allowed (`try { Function("") } catch`), the Content-Security-Policy refuses it, and Zod falls back to its normal path. It is the CSP doing its job, not a defect; the CSP deliberately does not allow `unsafe-eval`.
