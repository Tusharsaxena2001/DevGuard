# DevGuard — Product Requirements (MVP)

## Problem
A developer on a company laptop accidentally points a confidential/client repository at a personal GitHub remote and runs `git push`. The whole project becomes exposed. The company cannot see or prevent it.

## Principle
Prevent *mistakes* in ordinary developer Git workflows through deterministic rules. Not a monitor of all employee activity; not complete exfiltration prevention.

## Users and roles
| Role | Needs |
|------|-------|
| Employee (developer) | Normal pushes to approved remotes just work; clear explanation when blocked; can request an exception. |
| Team lead / project owner | Manage projects and people in their scope; approve/reject exceptions for their projects. |
| Security admin | Global view; define policies, classifications, destinations; review incidents, audit history, metrics. |

## Capabilities
**A. Git protection (agent):** enroll device; register repo to a project; install managed `pre-push`; inspect destination and outgoing commits; block unapproved destinations for protected projects; detect prohibited files and high-confidence secrets in outgoing history; explain blocks; record events; audit-only mode.
**B. Dashboard:** employees/devices, projects, approved destinations, policies + enforcement modes, event review/detail, exception review, metrics + recent incidents, policy/admin audit history. Real APIs, persistent storage; seeded demo data is explicit.
**B+. Alerts (ADR-009):** blocked pushes and exception requests notify the responsible owner/leads (high-severity items also notify security admins) through an in-app inbox, email, and per-project Slack/Teams webhooks. Best-effort convenience; the dashboard is the record.
**C. Exceptions:** developer requests; authorised approver decides; scoped to project + destination with reason + expiry; audited; developer retries push. API enforces scope/expiry independent of UI. No permanent blanket access. No real-time approval inside the hook.

## Key behaviors
- Protection is configured from the dashboard (projects, assignments, canonical repos, destinations, policy). Developers do a one-time install/enroll only; the agent matches local repos to assigned projects automatically (ADR-008). Repos matching no project are not protected (documented, ADR-003).
- Classification: internal, confidential, client-owned. Mode: `enforce` or `audit-only`.
- Offline/stale policy: see ADR-004.
- Events hold minimum metadata (rule id, type, path, destination, refs, decision); never file contents or secret values.

## Non-goals
Browser upload, USB, kernel drivers, enterprise DLP, network inspection, screenshots/keystrokes/browsing surveillance, tamper-proof claims, AI decisions about push safety, multi-provider LLMs, microservices/Kubernetes.

## Success criteria (Definition of Done)
See task brief section 15; operationalised as acceptance criteria per module in `docs/modules/` and the gates in `.claude/workflows/module-delivery.md`.

## Known limitations (to be published in README)
Hooks can be removed/bypassed (`git push --no-verify`, deleting hook, `core.hooksPath`, other tooling); only Git push is covered; secret detector is minimal; agent is not tamper-proof; events show observed attempts, not proof of leakage.
