# How to test DevGuard

DevGuard is a safety net against **mistaken pushes**: a Git hook on the laptop blocks a push of a protected project to a place it should not go (or one that contains a secret or a prohibited file), and everything is controlled and recorded from a dashboard. This guide walks the whole product end to end, then lists the automated suites.

Everything below was run against this repository while it was written. Where a command prints something, the text shown is what you should see.

> **Read this first: what DevGuard does not do.** A developer can bypass the hook (`git push --no-verify`, deleting the hook, a repo-level `core.hooksPath` such as husky, another Git client or machine). It is a guardrail, not tamper-proof enforcement, and an event records *an observed push attempt and a decision*, never proof that data did or did not leave. The built-in secret detector is small and not comprehensive.

---

## Fast path: run the whole thing automatically

After the setup in section 1 (database up, `pnpm build` done) one command runs scenarios A to L below against a real API, Postgres, the built CLI and real `git push` on a sandbox laptop. It uses its own throwaway database (`devguard_e2e`), so your dev data is untouched.

```bash
pnpm e2e:demo -- --port 3931        # pick a free port; 3000 is often taken
bash scripts/e2e-demo.sh --only D,F # just some scenarios (A and B always run)
bash scripts/e2e-demo.sh --keep     # leave API, dashboard (5173) and sandbox up, prints logins
bash scripts/e2e-demo.sh --stop     # tear down what --keep left behind
```

It prints `PASS`/`FAIL` per check, a summary, and exits non-zero on any failure (with the API log tail). It covers the admin side over HTTP (the same calls the dashboard makes) and everything on the laptop. It does **not** click the dashboard: use the UI checklist below for that.

### UI checklist (Playwright MCP, or by hand)

`.mcp.json` registers the Playwright MCP server (pinned, uses your installed Chrome). Approve it once in Claude Code, then ask Claude to run this checklist, or follow it by hand against `bash scripts/e2e-demo.sh --keep`:

1. Sign in as `admin@example.test`; sign out; a wrong password shows an error; `alice@example.test` is told the dashboard is for administrators.
2. **Overview**: blocked/allowed counts match what the script did.
3. **Events**: filter by *Decision = blocked*, paste a *Reference*; **Details** shows the file and rule, never a secret value.
4. **Projects**: add a lookalike destination (`https://github.com.evil.example@github.com/acme/portal`): refused with a reason code only. Save a policy version.
5. **Devices**: issue a token (shown once), revoke a device.
6. **Approvals**: with a pending request, review it as `admin2@example.test`; approve; revoke.
7. **Audit**: each change above appears, with who did it.

Automated UI coverage remains the dashboard component tests (`pnpm --filter @devguard/dashboard test`); the MCP run is interactive verification, not a CI suite.

---

## 1. Set up (once, about 5 minutes)

Requirements: Node 22+, pnpm 10+, Docker with Compose v2, Git 2.30+.

```bash
cp .env.example .env            # then edit: set JWT_SECRET to 32+ random characters (see below)
pnpm install
pnpm db:up                      # Postgres on localhost:5433 (wait until `docker compose ps` says healthy)
set -a; . ./.env; set +a        # the Prisma CLI and the seed read DATABASE_URL from the environment
pnpm --filter @devguard/shared build
pnpm --filter @devguard/policy-engine build
pnpm --filter @devguard/api prisma:deploy
SEED_PASSWORD='choose-a-12+-character-password' pnpm --filter @devguard/api seed
pnpm --filter @devguard/api build
pnpm --filter @devguard/agent build
```

* `JWT_SECRET`: any 32+ character random string, for example `openssl rand -base64 36`. The API refuses to start without it.
* The seed creates five **synthetic** users, all with the password you set: `admin@example.test` and `admin2@example.test` (security admins), `alice@example.test`, `bob@example.test` and `lead@example.test` (people), plus two sample projects. If you leave `SEED_PASSWORD` unset a random one is printed once. The seed refuses to run with `NODE_ENV=production`.
* **Two admins matter**: a request can never be approved by the person who made it, so approving needs a second admin.

Start the API and the dashboard (two terminals; keep the `.env` variables loaded in the first):

```bash
# terminal 1: API  (default port 3000; if that is taken, pick another: API_PORT=3917)
pnpm --filter @devguard/api start        # or: start:dev to run from source

# terminal 2: dashboard at http://localhost:5173  (it proxies /v1 to the API, so cookies just work)
DEVGUARD_API_URL=http://localhost:3000 pnpm --filter @devguard/dashboard dev
```

If port 3000 is busy on your machine, start the API with `API_PORT=3917` and the dashboard with `DEVGUARD_API_URL=http://localhost:3917`; use that URL wherever this guide says `http://localhost:3000`.

Check it: `curl localhost:3000/health` prints `{"status":"ok"}`, and `http://localhost:3000/docs` shows the API reference.

Open **http://localhost:5173** and sign in as `admin@example.test`.

## 2. A throwaway "laptop"

Do **not** test the hook against your real Git setup. This script gives you a sandbox shell with its own `HOME`, global Git config and DevGuard state, two fake remotes (`git@github.com:acme/portal.git` = the approved one, `git@github.com:personal/fork.git` = a personal one) and a `devguard` command:

```bash
source scripts/sandbox-laptop.sh        # in a third terminal
devguard status                         # Device: not enrolled
```

Everything below that starts with `devguard` or `git` runs in that sandbox terminal. Close it (or run `sandbox_cleanup`) to throw the laptop away.

---

## 3. Walkthrough

### A. Protect a project from the dashboard (no laptop work)

1. **Projects** -> create `Portal` (confidential).
2. Open it. Under **People covered** tick *Alice Employee* -> **Save people**. Only people listed here receive the project's rules.
3. Under **Approved destinations** add `https://github.com/acme/portal` (any spelling works: `git@github.com:Acme/Portal.git` is stored as `github.com/acme/portal`).
4. Under **Canonical repositories** add the same URL. This is how a laptop recognises the project by its remote.
5. Under **Policy** leave *Enforce*, check the file patterns (`.env`, `*.pem`, ...) and secret rules, and **Save new version** (this creates version 2).

Try a bad one: add `https://github.com.evil.example@github.com/acme/portal` or `https://user:pw@github.com/acme/portal`. It is refused; only a reason code is shown, never the value.

### B. Enroll the laptop (once)

1. Dashboard -> **Devices** -> *Enroll a laptop* -> choose Alice -> **Issue token**. Copy the token; it is shown once and expires in 30 minutes.
2. In the sandbox terminal:

```bash
echo '<paste token>' | devguard enroll --server http://localhost:3000 --token-stdin
```

Expected: `Enrolled this device with ...`, `DevGuard's global hook is installed.` and `Synced N project(s) from the server.` The token is never echoed; use `--token-stdin` so it stays out of shell history.

```bash
devguard status --check-server
```

Expected: `Device: enrolled`, the project listed under *Cached policies* "from the server", `Global hook: installed`, and `Server check: reachable, and it accepted this device.` The laptop now shows up in **Devices** with a recent *Last seen*.

Re-using the token fails with `The enrollment token is invalid, expired or already used.`

### C. Push to the approved destination -> allowed

```bash
echo "change" >> README.md && git commit -qam "change"
git push origin main            # silent success
```

No message, and the commit lands in the acme bare repo. (The first push also tells the server this repo's first-commit hash, see **Projects -> Detected repositories**.)

### D. Push to a personal repo -> blocked

```bash
git push fork main
```

Expected:

```
DevGuard blocked this push.
  Project: Portal (confidential, enforce)
  Destination: github.com/personal/fork
  Why:
    - The push destination is not approved for this project.
  Next: ...
  To ask for an exception to this destination:
    devguard request-exception --project <id> --destination https://github.com/personal/fork --reason "why you need it"
  Reference: <uuid>
error: failed to push some refs ...
```

The personal bare repo is unchanged. Copy the **Reference**.

### E. See it in the dashboard

**Events**: the blocked push is there within seconds (paste the Reference into the *Reference* filter to find exactly that one). Open **Details**: rule, mode, policy version, refs. **Overview** counts it under *Blocked*.

### F. A secret in the commits -> blocked (history is scanned, not just the last file)

```bash
printf 'export const token = "%s";\n' "ghp_$(printf 'Q%.0s' $(seq 1 36))" > config.ts   # a fake, synthetic token
git add config.ts && git commit -qm "oops"
git push origin main            # blocked: secret_detected, with the file and line, never the value
git rm -q config.ts && git commit -qm "remove it"
git push origin main            # STILL blocked: the secret is in an outgoing commit's history
```

The Events detail shows `secret: github_token in config.ts:1`. DevGuard never sends file contents or the secret value (check the request: `devguard` only sends rule, kind, path and line).

To continue, make a clean branch: `git reset -q --hard origin/main`.

### G. A rewired remote is still caught

```bash
git remote set-url origin git@github.com:personal/fork.git
echo more >> README.md && git commit -qam more && git push origin main    # blocked
git remote set-url origin git@github.com:acme/portal.git
```

The repo is recognised by its first commit, not just its URL.

### H. The exception flow (needs two admins)

1. On the laptop, after the block in D, use the command the message gave you:

```bash
devguard request-exception --destination https://github.com/personal/fork --reason "Handing the prototype to the customer"
# Requested an exception for Portal to push to github.com/personal/fork. Request id: ...
devguard exception status        # waiting for an administrator
```

2. Dashboard -> **Approvals** (signed in as `admin@example.test`): the request is pending, scoped to *Portal -> github.com/personal/fork*. Open a **private window**, sign in as `admin2@example.test`, **Review** it, give a reason and an expiry (max 72 hours) and **Approve**.
   * The requester can never decide their own request: even if the requester were an admin, **Approve** is disabled and the server answers 403 `self_approval_forbidden`.
3. Back on the laptop, retry:

```bash
git push fork main
# DevGuard: allowed by approved exception <id>.
```

The Events list now shows that push as **exception**, with the exception id.

4. Things to try: let it expire (set a near expiry), **Revoke approval** in the dashboard (the next push is blocked again), or push a *secret* to the approved fork: the exception covers the **destination only**; secrets and prohibited files still block.

### I. Audit-only mode

**Projects -> Portal -> Policy** -> mode *Audit only* -> **Save new version**. The next push to `fork` is **allowed** with `DevGuard (audit-only): this push would be blocked in enforce mode. It was allowed and recorded.` The event shows *would be blocked: yes*. Switch back to *Enforce* when done.

### J. Offline and stale policy

Stop the API (Ctrl-C in terminal 1), then on the laptop:

```bash
git push fork main                       # still blocked: the cached policy is used offline
git push origin main                     # still allowed
devguard status                          # "Pending events: N": queued, will be delivered later
```

To see the rule for a policy that is too old (default limit 60 minutes), age the cache:

```bash
for f in "$DEVGUARD_HOME"/policies/*.json; do
  python3 - "$f" <<'PY'
import json, sys, datetime
p = sys.argv[1]; d = json.load(open(p))
d["fetchedAt"] = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
json.dump(d, open(p, "w"))
PY
done
git push origin main
```

Expected for an **enforce** project: `DevGuard blocked this push: its saved policy for this project is out of date and the server could not be reached.` (even to the approved destination). For an **audit-only** project it is allowed and recorded. Start the API again and push once more: it works again, and the queued events are delivered (`devguard sync` does it explicitly).

### K. Revoke a device, unassign a person

* **Devices -> Revoke** (confirm). On the laptop `devguard status --check-server` now says `This device has been revoked by an administrator.` It can no longer sync, deliver events or use exceptions; cached policy rules still apply to protected repos.
* **Projects -> Portal -> People covered**: untick Alice and save. At her next push or `devguard sync` the project is dropped from her laptop and the repo is no longer protected (a repo that matches no assigned project is not protected, by design).

### L. Everything is audited

**Audit** lists every change with who did it: project, members, destinations, policy versions (with before/after mode), exceptions (requested/approved/revoked), device enrollment and revocation. It is append-only: there is no way to edit or delete an entry, and the database itself rejects it.

---

## 4. Automated tests

```bash
pnpm typecheck && pnpm lint && pnpm build
pnpm test                                    # everything, below
```

| Suite | What it proves | Tests (at the time of writing) |
|---|---|---|
| `packages/shared` | contracts accept the right shapes and reject content fields | 47 |
| `packages/policy-engine` | destination normalisation (lookalikes, userinfo), secrets, exceptions, decisions | 417 |
| `apps/api` | auth, scoping, enrollment races, policy versions, events, exceptions, audit, metrics, against a real Postgres (`devguard_test`, created and dropped by the suite) | 370 |
| `apps/agent` | CLI, local store permissions, sync and offline rules, event spool, real `git push` through the installed hook against bare remotes, and against a stub API | 855 |
| `apps/dashboard` | loading/empty/error states, role-aware routing, the main flows, layering rules | 73 |

Needs `pnpm db:up` first (API tests). Counts grow as modules are added; what matters is that none fail.

Run one workspace: `pnpm --filter @devguard/api test`. The API tests need `DATABASE_URL` (read from `.env`).

## 5. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| API exits: `Invalid configuration: JWT_SECRET` | set `JWT_SECRET` to 32+ characters in `.env` |
| `ECONNREFUSED ... 5433` | `pnpm db:up` and wait for healthy |
| `/v1/auth/me` returns 404 and `x-powered-by: Express` | another program owns port 3000; start the API with `API_PORT=3917` and the dashboard with `DEVGUARD_API_URL=http://localhost:3917` |
| `devguard enroll` says invalid or expired token | tokens are single use and last 30 minutes; issue a new one |
| `devguard enroll` says "must be https" | plain `http://` is only accepted for `localhost`/`127.0.0.1` |
| A push is not blocked | the repo matches no assigned project (check *People covered* and the canonical repo), the hook is missing (`devguard status`), or `--no-verify` was used |
| Prisma: `Connection url is empty` | `set -a; . ./.env; set +a` before the Prisma commands and the seed |
| Dashboard shows "This dashboard is for security administrators" | you signed in as a non-admin; use `admin@example.test` |

## 6. Known limits of this build (so nothing surprises you)

* Dashboard access is **security admins only**; team-lead and project-owner scoping is deferred ([ADR-014](../decisions/ADR-014-mvp-authorization-scope.md)). Alerts are minimal: only email to security admins for blocked pushes and secret/scan-error events (run `docker compose up -d mailpit`, inbox at http://localhost:8025). Slack/Teams, the in-app inbox, per-project recipients, retries and throttling are not built ([ADR-016](../decisions/ADR-016-minimal-email-alerts.md)).
* An exception stays valid for every push until it expires (up to 72 hours), and needs the server to be reachable at push time.
* Linux only. Local files are protected by file permissions, not encryption; a local user can read their own device secret.
* Not covered: browser uploads, USB, email, other Git clients, or pushes that skip the hook.
