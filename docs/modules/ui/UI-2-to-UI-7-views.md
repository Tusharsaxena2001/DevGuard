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
