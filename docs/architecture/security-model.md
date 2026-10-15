# Security model

## Assets
Source code of protected projects; policy integrity; device credentials; event/audit integrity; approval decisions.

## Trust boundaries
Developer machine (semi-trusted, user has control) | Agent <-> API | Dashboard <-> API | API <-> DB. The API is the sole authority for policy and exceptions.

## What DevGuard protects
Accidental pushes via `git push` from a machine where the agent hook is installed to a destination not approved for a registered project; prohibited files/secret patterns in the outgoing commit range.

## What it does NOT protect (honest limits)
- Remote aliasing outside Git's URL: an ssh `Host`/`HostName` alias in `~/.ssh/config` that points an approved-looking name at another server cannot be detected by URL inspection. `insteadOf`/`pushInsteadOf` rewriting is handled by evaluating the effective URL Git passes to the hook.
- A repo the agent never matched to a project (e.g. created locally and pushed to a personal remote before a canonical remote was ever seen).
- `git push --no-verify`, deleting/replacing the hook, a repo-level `core.hooksPath` (e.g. husky) overriding the global one, `git -c`, uninstalling the agent, using a different clone/machine.
- Non-Git channels: browser upload, email, USB, cloud sync, copy/paste, screenshots, other Git clients that skip hooks, `git bundle`, patches.
- Determined malicious insiders. The agent is not tamper-proof.
- Secrets not matching the minimal detector (ADR-005).
- Alert delivery guarantees: alerts are best-effort (retries then `failed`); a missed or delayed alert is possible. The dashboard is the record.
Missing/removed hooks are detectable only indirectly (device status/last-seen); the dashboard shows hook status when the agent reports it, not proof of absence.

## Threats and mitigations
| Threat | Mitigation |
|--------|-----------|
| Remote rewired to personal repo to dodge matching | Repo identified by root-commit fingerprint, not remote URL (ADR-008) |
| Bogus fingerprint reported by a device | Accepted only from assigned users, attributed, reviewable/removable; can only make that device's repo stricter |
| Lookalike/userinfo destination (`github.com@evil.io`, `github.com.evil.io`) | Strict URL parser, exact normalized host + repo match, reject on parse failure |
| History-only secret (added then deleted) | Scan `rev-list` of outgoing range, not working tree |
| Client claims approval | Server validates exceptions by project+destination+expiry; agent never self-approves |
| Stolen device credential | Per-device secret, hashed server-side, revocable, least privilege (events/policy/exception endpoints only) |
| Privilege escalation in dashboard | Server-side RBAC + project scope checks; tests per role |
| Secret leakage via logs/events | Minimal event schema, redaction guard on ingestion, logger redaction |
| Tampering with audit history | Append-only audit; no update/delete routes; admin changes attributable |
| Backend outage | ADR-004: bounded stale policy, then block (enforce) / allow+local record (audit-only) |
| Webhook URL abused for SSRF / leaked | https + hostname allowlist, DNS/private-range checks, no redirects, encrypted at rest, never returned or logged (ADR-009) |
| Alert leaks data or reaches wrong people | Recipients resolved server-side by membership; alerts carry metadata only, never contents/secrets |
| Brute force / enumeration | Rate limits on login/enrollment/ingestion, generic auth errors |

### Local agent state
- Platform: Linux for the MVP (ADR-010). The checks below use POSIX permissions and ownership; they do not exist on Windows.
- State (`~/.config/devguard`, or `$DEVGUARD_HOME`) is trusted only if it is owned by the current user and not writable by others; credentials must also not be readable by others, be a regular file and not a symlink/FIFO. Anything else is refused, never read, and reported as a problem (not as "not enrolled").
- `DEVGUARD_HOME` is a supported override (needed for tests) and therefore also a bypass for anyone who controls the environment of `git push`, like `--no-verify` or `core.hooksPath`. Mitigation: the pre-push runner blocks, rather than allows, a protected repo when state is unusable (AG-3). Not tamper-proof (see limits above).

### The Git hook (ADR-011)
- The wrapper pins `DEVGUARD_HOME` and the absolute paths of node and the agent, so environment or `PATH` changes at push time cannot weaken it. It fails closed: missing agent, unreadable or untrusted state, unintelligible input, and (in enforce mode) internal errors all block; only a repo that matches no project is allowed (ADR-003).
- Still bypassable by design limits: `git push --no-verify`, editing or deleting the wrapper, `git -c core.hooksPath=...`, a repo-level `core.hooksPath` (detected and reported), other Git clients, other machines. Local state and the local event log are user-owned and unauthenticated.
- Terminal safety: anything from a repository or Git config that is printed (paths, ref names, hooks paths) is stripped of control characters and bidi/zero-width characters.

## Authorization matrix (summary; full in API-2)
| Action | employee | team_lead | project_owner | security_admin |
|--------|:-:|:-:|:-:|:-:|
| View own devices/events | ✓ | ✓ | ✓ | ✓ |
| View project events/devices | – | scope | scope | all |
| Manage projects/destinations/policy | – | – | scope | all |
| Request exception | ✓ | ✓ | ✓ | ✓ |
| Decide exception (not own) | – | scope | scope | all |
| Revoke device, manage users/roles | – | – | – | ✓ |
| View admin audit | – | scope | scope | all |

## Assumptions
Company-managed laptops; developers are not adversarial; TLS between agent/dashboard and API; Postgres access restricted.
