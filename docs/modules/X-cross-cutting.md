# X-1 / X-2 Cross-cutting modules

## X-1 Docker Compose and developer setup
- `docker-compose.yml`: Postgres 16 on host port 5433 (done). Add `api` and `dashboard` services once API-1/UI-1 exist (depends_on db healthy, env from `.env`). Agent is never containerised.
- README setup instructions kept accurate; `.env.example` complete; one-command bootstrap documented (`pnpm install && pnpm db:up && pnpm --filter api prisma migrate deploy && pnpm --filter api seed`).
- Acceptance: clean clone follows README to a running API + dashboard.

## X-2 E2E, hardening, demo
- Scripted e2e (temp repos + bare remotes + running API): register project -> enroll -> blocked push -> event visible -> request exception -> approve -> retry succeeds -> expiry blocks.
- Run `/security-review` and both review agents across all sensitive modules; fix findings.
- Authorization test sweep; redaction sweep; bypass scenarios documented.
- Demo script `docs/workflows/demo-script.md` using only synthetic data; README limitations section.
