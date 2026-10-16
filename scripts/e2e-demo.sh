#!/usr/bin/env bash
# Black-box end-to-end check of DevGuard: real API + Postgres + built CLI + real `git push` on a sandbox laptop.
# The admin side is driven over HTTP exactly as the dashboard does it.
#
#   bash scripts/e2e-demo.sh [--keep] [--only A,B,...] [--port 3917]
#
#   --keep   leave everything running afterwards (API, dashboard, sandbox) with prepared data, to click through
#   --only   run only these scenarios (A..L); scenarios build on each other, so A,B are always run first
#   --port   API port (default 3917; port 3000 is often taken)
#   --stop   tear down what a previous --keep run left behind (use the same --port)
#
# It uses its own database (devguard_e2e) which it creates and drops, so your dev data is never touched.
# Prerequisites: `pnpm db:up`, and the workspaces built (pnpm build).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

KEEP=0; STOP=0; ONLY=""; PORT=3917
while [ $# -gt 0 ]; do
  case "$1" in
    --) ;;
    --keep) KEEP=1 ;;
    --only) ONLY="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    --stop) STOP=1 ;;
    -h|--help) sed -n 2,12p "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

[ "${NODE_ENV:-}" = "production" ] && { echo "refusing to run with NODE_ENV=production" >&2; exit 2; }
[ -f .env ] || { echo "missing .env (cp .env.example .env)" >&2; exit 2; }
set -a; . ./.env; set +a
if [ "$STOP" = 1 ]; then
  set -a; . ./.env; set +a
  for p in "$PORT" 5173; do pid="$(ss -ltnp 2>/dev/null | grep ":$p " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)"; [ -n "$pid" ] && [[ "$(readlink "/proc/$pid/cwd")" == "$ROOT"* ]] && kill "$pid" && echo "stopped process on port $p"; done
  docker compose exec -T db psql -q -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS devguard_e2e WITH (FORCE)" && echo "dropped devguard_e2e"
  rm -rf "${TMPDIR:-/tmp}"/devguard-e2e.*; echo "removed temp directories"; exit 0
fi
[ -f apps/api/dist/main.js ] && [ -f apps/agent/dist/main.js ] || { echo "build first: pnpm build" >&2; exit 2; }

E2E_DB="devguard_e2e"
BASE_URL="$(node -e 'const u=new URL(process.env.DATABASE_URL);u.pathname="/'"$E2E_DB"'";console.log(u.href)')"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/devguard-e2e.XXXXXX")"
API="http://localhost:$PORT"
PASSWORD="e2e-$(openssl rand -hex 8)"
API_PID=""; DASH_PID=""
PASS=0; FAIL=0; FAILED_NAMES=()

psql_admin() { docker compose --project-directory "$ROOT" exec -T db psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d postgres "$@"; }

cleanup() {
  local code=$?
  if [ "$KEEP" = 1 ] && [ "$FAIL" = 0 ] && [ "$code" = 0 ]; then return; fi
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null
  [ -n "$DASH_PID" ] && kill "$DASH_PID" 2>/dev/null
  wait 2>/dev/null
  psql_admin -c "DROP DATABASE IF EXISTS $E2E_DB WITH (FORCE)" >/dev/null 2>&1
  [ -n "${SANDBOX:-}" ] && rm -rf "$SANDBOX"
  rm -rf "$WORK"
}
trap cleanup EXIT

# ---------- tiny helpers ----------
ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; [ -n "${2:-}" ] && printf '        %s\n' "$2" | head -8; }
check() { # check "name" <command...> : passes when the command succeeds
  local name="$1"; shift
  if "$@" >"$WORK/last.out" 2>&1; then ok "$name"; else bad "$name" "$(tail -5 "$WORK/last.out")"; fi
}
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }
wanted() { [ -z "$ONLY" ] || [[ ",$ONLY," == *",$1,"* ]] || [[ "$1" == "A" || "$1" == "B" ]]; }

# JSON: read stdin as `j`, print the value of a JS expression (strings raw, others as JSON).
jq_() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s||"null");const v=('"$1"');console.log(typeof v==="string"?v:JSON.stringify(v))})'; }

# api <jar> <METHOD> <path> [json] -> body on stdout, status in $WORK/status
api() {
  local jar="$1" method="$2" path="$3" body="${4:-}"
  local args=(-s -o "$WORK/body" -w '%{http_code}' -b "$WORK/$jar.jar" -c "$WORK/$jar.jar" -X "$method" "$API$path")
  [ -n "$body" ] && args+=(-H 'content-type: application/json' --data "$body")
  curl "${args[@]}" >"$WORK/status"
  cat "$WORK/body"
}
status() { cat "$WORK/status"; }
login() { api "$1" POST /v1/auth/login "{\"email\":\"$2\",\"password\":\"$PASSWORD\"}" >/dev/null; [ "$(status)" = 200 ]; }
rows() { jq_ 'Array.isArray(j)?j:j.items'; }

wait_for_api() { for _ in $(seq 1 60); do curl -sf "$API/health" >/dev/null && return 0; sleep 0.5; done; return 1; }
start_api() {
  JWT_SECRET="$JWT" DATABASE_URL="$BASE_URL" API_PORT="$PORT" NODE_ENV=development LOG_LEVEL=warn \
    THROTTLE_LIMIT=100000 AUTH_THROTTLE_LIMIT=10000 \
    node "$ROOT/apps/api/dist/main.js" >>"$WORK/api.log" 2>&1 &
  API_PID=$!
  wait_for_api
}
stop_api() { kill "$API_PID" 2>/dev/null; wait "$API_PID" 2>/dev/null; API_PID=""; }

# ---------- infrastructure ----------
if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/"; then
  echo "Port $PORT is already in use (maybe a running DevGuard API). Pick another: --port <n>" >&2
  trap - EXIT; rm -rf "$WORK"; exit 2
fi
section "Setting up (database $E2E_DB, API $API)"
docker compose ps db 2>/dev/null | grep -q healthy || { echo "Postgres is not running: pnpm db:up" >&2; exit 2; }
psql_admin -c "DROP DATABASE IF EXISTS $E2E_DB WITH (FORCE)" -c "CREATE DATABASE $E2E_DB" || { echo "could not create $E2E_DB" >&2; exit 2; }
JWT="$(openssl rand -base64 36)"
(DATABASE_URL="$BASE_URL" pnpm --filter @devguard/api prisma:deploy >"$WORK/migrate.log" 2>&1) || { cat "$WORK/migrate.log"; exit 2; }
(DATABASE_URL="$BASE_URL" SEED_PASSWORD="$PASSWORD" NODE_ENV=development pnpm --filter @devguard/api seed >"$WORK/seed.log" 2>&1) || { cat "$WORK/seed.log"; exit 2; }
start_api || { echo "API did not start:" >&2; tail -20 "$WORK/api.log" >&2; exit 2; }
echo "  API up, database migrated and seeded"

SANDBOX="$WORK/laptop"
# shellcheck disable=SC1091
source scripts/sandbox-laptop.sh "$SANDBOX" >/dev/null
export DEVGUARD_POLICY_MAX_STALE_MINUTES=60
WORKTREE="$SANDBOX/work/portal"
ACME_BARE="$SANDBOX/remotes/acme/portal.git"
FORK_BARE="$SANDBOX/remotes/personal/fork.git"
head_of() { git --git-dir="$1" rev-parse -q --verify refs/heads/main 2>/dev/null || echo none; }

login admin admin@example.test || { echo "admin login failed: HTTP $(status) $(cat "$WORK/body")"; tail "$WORK/api.log"; cat "$WORK/seed.log" | tail -5; exit 2; }
login admin2 admin2@example.test || { echo "admin2 login failed"; exit 2; }
ALICE_ID="$(api admin GET /v1/users | rows | jq_ 'j.find(u=>u.email==="alice@example.test").id')"

# ---------- A. protect a project from the "dashboard" ----------
section "A. Project, people, destination, policy"
PROJECT="$(api admin POST /v1/projects '{"name":"Portal E2E","classification":"confidential"}' | jq_ 'j.id')"
check "project created" test "$(status)" = 201
api admin PUT "/v1/projects/$PROJECT/members" "{\"userIds\":[\"$ALICE_ID\"]}" >/dev/null
check "Alice assigned to the project" test "$(status)" = 200
api admin POST "/v1/projects/$PROJECT/destinations" '{"url":"https://github.com/acme/portal"}' >/dev/null
check "approved destination added" test "$(status)" = 201
api admin POST "/v1/projects/$PROJECT/canonical-repos" '{"url":"https://github.com/acme/portal"}' >/dev/null
check "canonical repository added" test "$(status)" = 201
for bad_url in 'https://github.com.evil.example@github.com/acme/portal' 'https://user:pw@github.com/acme/portal'; do
  api admin POST "/v1/projects/$PROJECT/destinations" "{\"url\":\"$bad_url\"}" >/dev/null
  check "lookalike/userinfo destination refused ($bad_url)" test "$(status)" = 400 -o "$(status)" = 422
done
set_policy() { # set_policy <enforce|audit_only>
  local cur; cur="$(api admin GET "/v1/projects/$PROJECT/policy")"
  local base globs rules
  base="$(echo "$cur" | jq_ 'j.version')"; globs="$(echo "$cur" | jq_ 'j.prohibitedGlobs')"; rules="$(echo "$cur" | jq_ 'j.secretRules')"
  api admin PUT "/v1/projects/$PROJECT/policy" "{\"baseVersion\":$base,\"mode\":\"$1\",\"prohibitedGlobs\":$globs,\"secretRules\":$rules}" >/dev/null
  [ "$(status)" = 200 ]
}
check "policy saved (enforce)" set_policy enforce

# ---------- B. enroll ----------
section "B. Enroll the laptop"
TOKEN="$(api admin POST /v1/devices/enrollment-tokens "{\"userId\":\"$ALICE_ID\"}" | jq_ 'j.token')"
check "enrollment token issued" test "$(status)" = 201
check "devguard enroll" bash -c "echo '$TOKEN' | node '$ROOT/apps/agent/dist/main.js' enroll --server '$API' --token-stdin"
devguard status --check-server >"$WORK/st.out" 2>&1
check "device enrolled and server accepts it" bash -c "grep -q 'Device: enrolled' '$WORK/st.out' && grep -q 'accepted this device' '$WORK/st.out'"
check "project synced to the laptop" grep -q "Portal E2E" "$WORK/st.out"
check "global hook installed" grep -q "Global hook: installed" "$WORK/st.out"
echo "$TOKEN" | devguard enroll --server "$API" --token-stdin >"$WORK/reuse.out" 2>&1
check "token cannot be used twice" grep -qi "invalid, expired or already used" "$WORK/reuse.out"
DEVICE_ID="$(api admin GET /v1/devices | rows | jq_ 'j[0].id')"

blocked_msg() { grep -q "DevGuard blocked this push" "$WORK/push.out"; }
push() { (cd "$WORKTREE" && git push "$@" main >"$WORK/push.out" 2>&1); }
commit() { (cd "$WORKTREE" && echo "$RANDOM$RANDOM" >> README.md && git commit -qam "change $RANDOM"); }

# ---------- C/D. allowed and blocked ----------
if wanted C; then
  section "C. Push to the approved destination"
  commit; before="$(head_of "$ACME_BARE")"
  check "push to approved destination succeeds" push origin
  check "approved remote advanced" test "$(head_of "$ACME_BARE")" != "$before"
fi
if wanted D; then
  section "D. Push to a personal repository"
  commit; before="$(head_of "$FORK_BARE")"
  push fork; rc=$?
  check "push to personal repo is refused" test "$rc" != 0
  check "block message explains and offers an exception" blocked_msg
  check "personal remote is unchanged" test "$(head_of "$FORK_BARE")" = "$before"
  REF="$(grep -o 'Reference: [0-9a-f-]*' "$WORK/push.out" | head -1 | cut -d' ' -f2)"
  check "reference printed" test -n "$REF"
  devguard sync >/dev/null 2>&1
  api admin GET "/v1/events?correlationId=$REF" | rows | jq_ 'j.map(e=>e.outcome)' >"$WORK/ev.out"
  check "server recorded that push as blocked (same reference)" grep -q blocked "$WORK/ev.out"
fi

# ---------- F. secrets ----------
if wanted F; then
  section "F. Secret in outgoing history"
  SECRET="ghp_$(printf 'Q%.0s' $(seq 1 36))"
  (cd "$WORKTREE" && printf 'export const token = "%s";\n' "$SECRET" > config.ts && git add config.ts && git commit -qm "add config")
  before="$(head_of "$ACME_BARE")"; push origin; rc=$?
  check "secret commit is blocked" test "$rc" != 0
  check "secret message names the rule" grep -q "secret" "$WORK/push.out"
  check "secret value is not printed" bash -c "! grep -q '$SECRET' '$WORK/push.out'"
  (cd "$WORKTREE" && git rm -q config.ts && git commit -qm "remove config")
  push origin; rc=$?
  check "still blocked after deleting the file (history is scanned)" test "$rc" != 0
  check "approved remote unchanged" test "$(head_of "$ACME_BARE")" = "$before"
  devguard sync >/dev/null 2>&1
  api admin GET "/v1/events?outcome=blocked&pageSize=100" >"$WORK/events.json"
  check "event records the rule and file" bash -c "grep -q 'config.ts' '$WORK/events.json'"
  check "no event or API response contains the secret value" bash -c "! grep -q '$SECRET' '$WORK/events.json'"
  (cd "$WORKTREE" && git reset -q --hard origin/main 2>/dev/null || git reset -q --hard "$(head_of "$ACME_BARE")")
fi

# ---------- G. rewired remote ----------
if wanted G; then
  section "G. Rewired remote"
  (cd "$WORKTREE" && git remote set-url origin git@github.com:personal/fork.git)
  commit; push origin; rc=$?
  check "origin pointed at a personal repo is still blocked" test "$rc" != 0
  (cd "$WORKTREE" && git remote set-url origin git@github.com:acme/portal.git)
fi

# ---------- H. exceptions ----------
if wanted H; then
  section "H. Exception request, approval, use, revoke"
  commit
  (cd "$WORKTREE" && node "$ROOT/apps/agent/dist/main.js" request-exception --destination https://github.com/personal/fork --reason "Handing the prototype to the customer") >"$WORK/req.out" 2>&1
  check "exception requested" grep -qi "requested an exception" "$WORK/req.out"
  EXC="$(api admin GET "/v1/exceptions?status=pending" | rows | jq_ 'j[0]&&j[0].id')"
  check "request is pending on the server" test -n "$EXC" -a "$EXC" != null
  EXPIRES="$(node -e 'console.log(new Date(Date.now()+6*3600e3).toISOString())')"
  api admin POST "/v1/exceptions/$EXC/approve" "{\"reason\":\"Approved for the customer handover\",\"expiresAt\":\"$EXPIRES\"}" >/dev/null
  # admin approving is allowed here because the requester is Alice, not an admin; the self-approval rule is covered by the API suite.
  check "an administrator approves" test "$(status)" = 200
  api admin POST "/v1/exceptions/$EXC/approve" "{\"reason\":\"Approved again by mistake\",\"expiresAt\":\"$EXPIRES\"}" >/dev/null
  check "a decided request cannot be decided again" test "$(status)" -ge 400
  push fork; rc=$?
  check "push to the excepted destination is allowed" test "$rc" = 0
  check "allowed by approved exception message" grep -q "allowed by approved exception" "$WORK/push.out"
  # An exception never waives secrets.
  (cd "$WORKTREE" && printf 'export const t = "ghp_%s";\n' "$(printf 'R%.0s' $(seq 1 36))" > leak.ts && git add leak.ts && git commit -qm leak)
  push fork; rc=$?
  check "exception does not waive a secret" test "$rc" != 0
  (cd "$WORKTREE" && git reset -q --hard HEAD~1)
  api admin POST "/v1/exceptions/$EXC/revoke" '{"reason":"Handover finished early"}' >/dev/null
  check "approval revoked" test "$(status)" = 200
  commit; push fork; rc=$?
  check "after revoke the destination is blocked again" test "$rc" != 0
fi

# ---------- I. audit-only ----------
if wanted I; then
  section "I. Audit-only mode"
  check "policy switched to audit-only" set_policy audit_only
  devguard sync >/dev/null 2>&1
  commit; push fork; rc=$?
  check "push to fork is allowed in audit-only" test "$rc" = 0
  check "message says it would have been blocked" grep -q "would be blocked in enforce mode" "$WORK/push.out"
  devguard sync >/dev/null 2>&1
  api admin GET "/v1/events?pageSize=5" | rows | jq_ 'j.some(e=>e.wouldBlock===true&&e.mode==="audit_only")' >"$WORK/ao.out"
  check "server event shows would-block in audit-only" grep -q true "$WORK/ao.out"
  check "policy switched back to enforce" set_policy enforce
  devguard sync >/dev/null 2>&1
fi

# ---------- J. offline / stale ----------
if wanted J; then
  section "J. Server offline, stale policy"
  stop_api
  commit; push fork; rc=$?
  check "offline: fresh cached policy still blocks the personal repo" test "$rc" != 0
  push origin; rc=$?
  check "offline: approved destination still allowed" test "$rc" = 0
  devguard status >"$WORK/off.out" 2>&1
  check "offline: events are queued locally" bash -c "grep -Eq 'Pending events: [1-9]' '$WORK/off.out'"
  for f in "$DEVGUARD_HOME"/policies/*.json; do
    node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1]));d.fetchedAt=new Date(Date.now()-3*3600e3).toISOString();fs.writeFileSync(process.argv[1],JSON.stringify(d))' "$f"
  done
  commit; push origin; rc=$?
  check "offline + stale policy on an enforced project blocks" test "$rc" != 0
  check "stale message is readable" grep -q "out of date" "$WORK/push.out"
  start_api || bad "API restarted"
  devguard sync >/dev/null 2>&1
  push origin; rc=$?
  check "back online: pushes work again" test "$rc" = 0
  devguard status >"$WORK/on.out" 2>&1
  check "queued events delivered" grep -q "Pending events: 0" "$WORK/on.out"
fi

# ---------- K. revoke / unassign ----------
if wanted K; then
  section "K. Unassign a person, revoke the device"
  api admin PUT "/v1/projects/$PROJECT/members" '{"userIds":[]}' >/dev/null
  devguard sync >/dev/null 2>&1
  commit; push fork; rc=$?
  check "after unassigning, the repo is no longer protected" test "$rc" = 0
  api admin POST "/v1/devices/$DEVICE_ID/revoke" '{}' >/dev/null
  check "device revoked" test "$(status)" -lt 300
  devguard status --check-server >"$WORK/rev.out" 2>&1
  check "laptop is told it was revoked" grep -qi "revoked" "$WORK/rev.out"
fi

# ---------- L. audit and metrics ----------
if wanted L; then
  section "L. Audit trail and metrics"
  api admin GET "/v1/audit?pageSize=200" | rows | jq_ 'j.map(e=>e.action)' >"$WORK/audit.out"
  for action in project.created policy.updated exception.approved exception.revoked device.revoked; do
    check "audit contains $action" grep -q "$action" "$WORK/audit.out"
  done
  api admin GET "/v1/metrics/summary?range=24h" | jq_ 'j.outcomes' >"$WORK/m.out"
  check "metrics count blocked and allowed pushes" bash -c "grep -Eq '\"blocked\":[1-9]' '$WORK/m.out' && grep -Eq '\"allowed\":[1-9]' '$WORK/m.out'"
  api employee GET /v1/events >/dev/null; code="$(status)"
  check "unauthenticated access to events is refused" test "$code" = 401
  login employee alice@example.test
  api employee GET /v1/audit >/dev/null
  check "a non-admin cannot read the audit history" test "$(status)" = 403
  api employee POST /v1/projects '{"name":"Sneaky","classification":"internal"}' >/dev/null
  check "a non-admin cannot create a project" test "$(status)" = 403
  api employee GET "/v1/events?pageSize=200" | rows | jq_ 'j.length>0&&j.every(e=>e.userId==="'"$ALICE_ID"'")' >"$WORK/own.out"
  check "a non-admin sees only their own events" grep -q true "$WORK/own.out"
fi

# ---------- result ----------
section "Result"
printf '  %d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" != 0 ]; then
  printf '  failed: %s\n' "${FAILED_NAMES[@]}"
  echo "  API log tail:"; tail -15 "$WORK/api.log" | sed 's/^/    /'
  exit 1
fi

if [ "$KEEP" = 1 ]; then
  # Leave the stack up for clicking through the dashboard (Alice is re-assigned; the laptop's device stays revoked).
  cd "$ROOT"
  api admin PUT "/v1/projects/$PROJECT/members" "{\"userIds\":[\"$ALICE_ID\"]}" >/dev/null
  DEVGUARD_API_URL="$API" nohup pnpm --filter @devguard/dashboard dev >"$WORK/dashboard.log" 2>&1 &
  DASH_PID=$!; sleep 4
  cat <<EOF

Left running for manual / Playwright checks:
  Dashboard: http://localhost:5173
  API:       $API
  Logins:    admin@example.test and admin2@example.test (also alice@example.test, non-admin), password: $PASSWORD
  Sandbox:   $SANDBOX  (source scripts/sandbox-laptop.sh "$SANDBOX")
  Stop:      bash scripts/e2e-demo.sh --stop --port $PORT
EOF
fi
exit 0
