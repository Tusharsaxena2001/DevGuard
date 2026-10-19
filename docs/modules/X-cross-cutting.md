# X-1 / X-2 Cross-cutting modules

## X-1 Docker Compose and developer setup
- `docker-compose.yml`: Postgres 16 on host port 5433, Mailpit, `api` (dev image, healthcheck, migrations at start) and `dashboard` (`apps/dashboard/Dockerfile`: Vite build served by unprivileged nginx on host port 5173, proxying `/v1` and `/health` to `api:3000`). Agent is never containerised.
- README setup instructions kept accurate; `.env.example` complete; setup documented in the README (host path: `pnpm install && pnpm db:up && pnpm --filter @devguard/api prisma:deploy && pnpm --filter @devguard/api seed`; container path: `docker compose up -d --build`, then seed).
- Acceptance: clean clone follows README to a running API + dashboard.

## X-2 E2E, hardening, demo
- Scripted e2e (temp repos + bare remotes + running API): register project -> enroll -> blocked push -> event visible -> request exception -> approve -> retry succeeds -> expiry blocks.
- Run `/security-review` and both review agents across all sensitive modules; fix findings.
- Authorization test sweep; redaction sweep; bypass scenarios documented.
- Demo script `docs/workflows/demo-script.md` using only synthetic data; README limitations section.
