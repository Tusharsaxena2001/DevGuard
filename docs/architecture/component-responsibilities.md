# Component responsibilities

Three deployable components plus two shared packages. Each has one job; this page is the tie-breaker when deciding where code belongs.

| | Agent (`apps/agent`) | API (`apps/api`) | Dashboard (`apps/dashboard`) |
|---|---|---|---|
| **Role** | Enforcer on the laptop | Source of truth | Control surface for people |
| **Runs** | Developer's machine; hook is invoked by Git | Central server + PostgreSQL | Browser |
| **Owns** | Enrollment; global/per-repo hook install; pre-push runner; repo-to-project matching; local policy cache; event spool; exception request commands | Auth and RBAC; devices and enrollment tokens; projects, assignments, destinations, fingerprints; versioned policies; event ingestion; exception lifecycle and validation; admin audit; metrics; alerts and notifications | Login; role-aware navigation; management and review screens (devices, projects, policies, events, approvals, audit); notification inbox and alert settings |
| **Does not own** | Authoritative policy, identities, approvals, any UI | Git inspection (never sees repos or file contents), presentation | Any security decision, business rule or hardcoded data |
| **Works without** | The dashboard; the API (cached policy, ADR-004) | The agent; the dashboard | n/a (needs the API) |
| **Trust** | Semi-trusted: user controls the machine | Authoritative | Untrusted client: API enforces everything |

## Shared packages
- `packages/shared`: Zod contracts (the only place API, agent and dashboard agree on shapes).
- `packages/policy-engine`: pure, deterministic decision logic (destination, content, mode, exception validity). Used by agent (local enforcement) and API (exception validation).

## Placement test
- Needs Git, the file system or the developer's machine? Agent.
- Needs to know who the user is, what the rules are, or must be remembered? API.
- Is purely how something is shown or edited by a person? Dashboard.
- Is a pure rule used on both sides? `policy-engine`. A data shape used on both sides? `shared`.
