# UI-2 … UI-7 Dashboard views (apps/dashboard)

Each view: real API data, filters/pagination, loading/empty/error states, actionable errors. Visibility by role is a convenience; the API enforces access. Implemented as separate modules (one `/implement-module` run each).

| ID | View | API | Content | Depends on |
|----|------|-----|---------|-----------|
| UI-2 | Overview | API-7 | counts by outcome, blocked trend, top rules, pending exceptions, recent incidents list | API-7 |
| UI-3 | Devices and employees | API-2 | table (employee, device, OS, agent version, status, last seen), issue enrollment token, revoke (admin) | API-2 |
| UI-4 | Projects, destinations, policies | API-3, API-4 | project CRUD, classification, owners, **member/employee assignment**, canonical repos and destinations add/remove (normalized preview), **detected repos per device and fingerprints (view/remove/add)**, policy editor with mode (enforce/audit-only), version history. Everything a lead/admin needs to protect a project without touching a laptop | API-3, API-4 |
| UI-5 | Events | API-5 | filterable table; detail: timestamp, employee, device, project, destination, operation, decision, rule ids, mode, outcome, correlation id, policy version, exception/approver ref; no contents; wording does not claim proven leakage | API-5 |
| UI-6 | Approvals | API-6 | pending/resolved lists; approve (scope shown, reason, expiry) / reject (reason); decision history; self-approval disabled with server enforcement | API-6 |
| UI-7 | Audit history | API-7 | admin audit + policy change history with actor/action/target/time filters | API-7 |

## Acceptance (each)
Renders with seeded data; empty/error/loading states; forbidden handled; interactions hit real endpoints; component tests for states; build passes.

## Implemented (apps/dashboard)
- **UI-2 Overview:** outcome tiles, pending approvals, exceptions in force, device health, top rules, blocked pushes per day and project, recent blocked pushes, with a 24h/7d/30d period. Notes what the numbers cannot cover (`--no-verify`, other clients, laptops without the agent).
- **UI-3 Devices and people:** devices with owner, OS, agent version, status (active, stale after 24 hours, revoked) and last seen; issue a one-time enrollment token (shown once, with the command to run); revoke with confirmation; add a person (password of 12+ characters).
- **UI-4 Projects:** list and create; per project: people covered (assignment), policy editor (mode, prohibited patterns, secret rules; saving creates a new version from the version shown; an edit conflict is explained instead of overwriting) with version history, approved destinations and canonical repositories (add by URL with the server's normalisation, remove), detected repositories (first-commit fingerprints with their source and device; add, remove) and repos registered by hand.
- **UI-5 Events:** filter by decision, rule and the reference the developer was shown; paging; details with reference, operation, refs, mode, would-block, policy version, exception id and findings (rule, kind, path, line only). States that an event shows what the hook observed and decided, not that data left or stayed.
- **UI-6 Approvals:** pending by default, filter by status; scope, reason and history shown; approve (reason, expiry as an ISO time), reject (reason), revoke an approval in force; approving or rejecting your own request is disabled in the UI and refused by the server.
- **UI-7 Audit:** filter by kind of change and target id; actor, action, target and summary; states that it is append-only.
- **Not built:** UI-8 (alerts, API-8), employee views, charts.
