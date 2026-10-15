# 15-day MVP plan

Prioritises the prevention mechanism first. Day ranges are targets; gates matter more than dates.

| Days | Modules | Outcome |
|------|---------|---------|
| 1 | Scaffolding, SH-1 | Workspace + contracts compile |
| 2–3 | SH-2, SH-3, SH-4 | Policy engine fully unit-tested (URLs, lookalikes, files, secrets, modes, exceptions) |
| 4–6 | AG-1, AG-2, AG-3, AG-4 | **Gate 1:** real `git push` blocked/allowed via installed hook (global and per-repo), no backend, local policy file; history scan; fingerprint matching survives remote rewiring; hook reversible |
| 7 | API-1, API-2 | DB, migrations, seed, login, RBAC, device enrollment/revocation |
| 8 | API-3, API-4, AG-5, AG-6 | Projects/destinations/policies; agent enrolls and syncs; offline cache |
| 9 | API-5, AG-7 | **Gate 2:** events delivered with device identity, redaction enforced |
| 10 | API-6, AG-8 | Exception request/decision; server-side scope/expiry |
| 11 | API-7, API-8 | Audit + metrics; alerts (inbox, email via Mailpit, Slack/Teams webhooks) |
| 11–13 | UI-1..UI-8 | Dashboard views backed by real APIs, metrics, audit, notifications |
| 14 | X-2 | **Gate 3/4:** e2e flow, security + test review, authz tests, bypass tests |
| 15 | X-2 | Docs, demo script, release fixes, buffer |

Cut order if behind: UI-2 polish, UI-7 filters, AG-7 spool sophistication, metrics breadth, Teams/Slack channels (keep inbox + email). Never cut: SH-*, AG-2/3, API-2/6 authorization, redaction, limitations docs.
