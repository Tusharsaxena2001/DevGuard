# Module roadmap

Status: `todo` | `in-progress` | `done`. Update via `/implement-module`. Specs: `docs/modules/<surface>/<ID>-*.md`.

## Shared (packages/)
| ID | Module | Depends on | Status |
|----|--------|-----------|--------|
| SH-1 | Shared contracts | — | done |
| SH-2 | Policy engine: destination | SH-1 | done |
| SH-3 | Policy engine: content (files + secrets) | SH-1 | done |
| SH-4 | Policy engine: decision (modes, exceptions, fail-safe) | SH-2, SH-3 | done |

## Agent (apps/agent)
| ID | Module | Depends on | Status |
|----|--------|-----------|--------|
| AG-1 | CLI skeleton + local config/credential store | SH-1 | done |
| AG-2 | Git hook installer (global + per-repo, ADR-008) | AG-1 | done |
| AG-3 | pre-push runner | AG-1, SH-4 | done |
| AG-4 | Repo resolution + project matching (fingerprint/remote/manual) | AG-1 | done |
| AG-5 | Enrollment + API client | AG-1, API-2 | done |
| AG-6 | Policy sync + offline cache | AG-5, API-4 | done |
| AG-7 | Event delivery | AG-5, API-5 | done |
| AG-8 | Exception request/status | AG-5, API-6 | done |

## API (apps/api)
| ID | Module | Depends on | Status |
|----|--------|-----------|--------|
| API-1 | Foundation (schema, migrations, seed, OpenAPI) | SH-1 | done |
| API-2 | Auth, RBAC, device identity (admin/employee/device; project-scoped RBAC deferred, ADR-014) | API-1 | done |
| API-3 | Projects, assignments, canonical repos, fingerprints, destinations | API-2 | done |
| API-4 | Policies (versioned) + agent project sync | API-3 | done |
| API-5 | Security events | API-2, API-3 | done |
| API-6 | Exceptions | API-4, API-5 | done |
| API-7 | Admin audit + metrics | API-2..6 | done |
| API-8 | Alerts + notifications (inbox, email, Slack/Teams) | API-2, API-5, API-6 | in-progress (minimal email to security admins done, ADR-016; inbox, Slack/Teams, exception mails, retries, throttling deferred) |

## UI (apps/dashboard)
| ID | Module | Depends on | Status |
|----|--------|-----------|--------|
| UI-1 | App shell, auth, routing | API-2 | done |
| UI-2 | Overview | API-7 | done |
| UI-3 | Devices and employees | API-2 | done |
| UI-4 | Projects, destinations, policies | API-3, API-4 | done |
| UI-5 | Events | API-5 | done |
| UI-6 | Approvals | API-6 | done |
| UI-7 | Audit history | API-7 | done |
| UI-8 | Notifications + alert settings | API-8, UI-1 | todo (deferred: alerts are not part of the hackathon build) |

## Cross-cutting
| ID | Module | Status |
|----|--------|--------|
| X-1 | Docker Compose + dev setup | done (db, mailpit, api and dashboard services; `docker compose up -d --build` verified: healthy stack, sign-in and API calls through nginx; API image fixed to build `policy-engine`) |
| X-2 | E2E, hardening, demo, limitations | done (62-check `scripts/e2e-demo.sh`; security and test review sweeps run and their findings fixed or documented; authorization and redaction sweeps; demo script `docs/workflows/demo-script.md`; bypass and dev-stack limits in `security-model.md`; README limitations) |

## Build order
SH-1 -> SH-2/3/4 -> AG-1 -> AG-2 -> AG-3 -> AG-4 (**Gate 1**) -> API-1..3 -> AG-5 -> API-4 -> AG-6 -> API-5 -> AG-7 (**Gate 2**) -> API-6 -> AG-8 -> API-7 -> API-8 -> UI-1..8 (UI-1 may start after API-2) (**Gate 3**) -> X-2 (**Gate 4**).
