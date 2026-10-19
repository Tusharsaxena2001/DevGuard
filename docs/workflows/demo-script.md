# Demo script (about 10 minutes)

Audience: someone seeing DevGuard for the first time. Everything is **synthetic**: seeded `*@example.test` users, a sandbox "laptop" with fake remotes, and secret-looking strings built at runtime. No real repository, credential or company data is used. Detailed steps and expected output for every flow: [`docs/testing/how-to-test.md`](../testing/how-to-test.md).

## Before you start (not part of the demo)
1. Setup from the README (host path or `docker compose up -d --build`), seed with a `SEED_PASSWORD` you know, build the agent (`pnpm --filter @devguard/agent build`).
2. Dashboard at http://localhost:5173, Mailpit inbox at http://localhost:8025 (set `SMTP_HOST` for the API to see alert mail).
3. A sandbox terminal: `source scripts/sandbox-laptop.sh`. If you only want to click through prepared data: `bash scripts/e2e-demo.sh --keep --port 3931` (stop with `--stop`).
4. Dry run once. If port 3000 is taken, use `API_PORT` and `DEVGUARD_API_URL` as the guide says.

## The story
| # | Say | Do | What the audience sees |
|---|-----|----|------------------------|
| 1 | "Protection is configured by admins, not developers." | Dashboard: create project *Portal*, assign Alice, add destination and canonical repo `https://github.com/acme/portal`, save a policy (enforce). Try the lookalike `https://github.com.evil.example@github.com/acme/portal`. | Lookalike is refused with a reason code only. |
| 2 | "The developer does one thing: enroll." | Issue a token for Alice; in the sandbox `echo '<token>' \| devguard enroll --server <url> --token-stdin`. | Hook installed, project synced, device appears in **Devices**. |
| 3 | "An approved push just works." | `git push origin main` in `~/work/portal`. | Push succeeds; event appears as allowed. |
| 4 | "A push to a personal remote is blocked, before anything leaves." | `git push fork main`. | Readable block message; the personal bare remote is unchanged; **Events** shows *blocked*. If SMTP is on, an admin alert mail arrives in Mailpit (metadata only). |
| 5 | "History is scanned, not just the working tree." | Commit a synthetic secret, delete it in the next commit, push to the approved remote. | Blocked on the earlier commit; the event shows rule and file path, **never the value**. |
| 6 | "Exceptions are scoped, expiring and approved by someone else." | `devguard request-exception --destination https://github.com/personal/fork --reason "..."`; as `admin2` approve it in **Approvals** with a reason and expiry; retry the push. Then revoke it and push again. | Push passes while approved, blocks again after revoke. The requester cannot approve their own request. |
| 7 | "Everything is attributable." | **Audit** page. | Every change above with who and when; no edit or delete. |

## Say honestly at the end
- It is a safety net against **mistaken** pushes, not a tamper-proof control: `--no-verify`, deleting the hook, `core.hooksPath` and other Git clients bypass it.
- Only Git push is covered; only repos matching an assigned project are protected.
- The secret detector is minimal. An event says the hook observed an attempt, not whether data was exposed.
- Alerts are minimal: email to security admins, best-effort. Full list: README *Limitations* and [`security-model.md`](../architecture/security-model.md).

## If something goes wrong
`devguard status --check-server` first. The troubleshooting table in `how-to-test.md` covers port 3000 conflicts, spent enrollment tokens and "push not blocked".
