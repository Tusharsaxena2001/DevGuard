# The laptop tool: what it looks like and how it is installed

Short answer: the tool on a developer's laptop is a **command-line program with a Git hook**. It has **no window, tray icon or desktop notification**. The only graphical interface in DevGuard is the admin **dashboard** in a browser, and developers never use it.

## What the developer sees

A developer installs the tool and enrolls **once**. After that, a managed global Git `pre-push` hook runs on every `git push`. Terminal text is the whole interface, so it appears in whatever shows Git's output (a terminal, or an IDE's Git panel).

**A normal push:** silent. Nothing changes in their workflow.

**A blocked push** (text is from `apps/agent/src/presentation/pre-push.ts`):

```
DevGuard blocked this push.
  Project: Portal (confidential, enforce)
  Destination: github.com/personal/fork
  Why:
    - The push destination is not approved for this project.
  Next: push to an approved destination, or remove the flagged content from the commits you are pushing
        (it stays in history until the commits are rewritten), or ask for an exception.
  To ask for an exception to this destination:
    devguard request-exception --project <id> --destination https://github.com/personal/fork --reason "why you need it"
  Reference: <uuid>
```

A secret or prohibited file adds a "Details" block with the rule, file path, line and commit, **never the secret value**. Other messages: audit-only ("this push would be blocked in enforce mode. It was allowed and recorded."), allowed by an approved exception, "could not check this push" (with `devguard status` as the next step), and a stale-policy block ("its saved policy for this project is out of date and the server could not be reached ... run 'devguard sync'", default limit 60 minutes).

**Commands** (`devguard --help`; add `--json` for machine-readable output):

| Command | Purpose |
|---|---|
| `devguard enroll --server <url> --token-stdin` | One-time enrollment with the token an admin issued; installs the global hook and syncs the projects |
| `devguard status [--check-server]` | Enrollment, hook state, cached policies and their age, queued events, which project (if any) protects this repository |
| `devguard sync` | Refresh policies and deliver queued events |
| `devguard request-exception --destination <url> --reason "<text>"` | Ask an admin to allow a blocked destination |
| `devguard exception status [id]` | Waiting, approved (until when), rejected, expired or revoked |
| `devguard install` / `uninstall` (`--global` or `--repo <path>`) | Install or remove the hook; uninstall restores the previous Git setup |
| `devguard register` / `unregister` | Manually link a repository to a project (fallback when automatic matching cannot) |

## How it is distributed today

**There is no installer, package or auto-update yet.** A developer (or an admin on their behalf) installs from the repository ([usage.md](usage.md) section 1): Node 22+, pnpm 10+ and Git 2.30+, then:

```bash
git clone <this repository> && cd dev-guard
pnpm install
pnpm --filter @devguard/shared build
pnpm --filter @devguard/policy-engine build
pnpm --filter @devguard/agent build
ln -sf "$PWD/apps/agent/dist/main.js" ~/.local/bin/devguard
```

Things to know:
- **The clone must stay where it is.** The hook records the absolute paths of `node` and of the built agent when it is installed. If the folder moves, or Node is upgraded or removed, the hook cannot find the agent and **blocks every push** with instructions until `devguard install --global` is run again. This is deliberate (fail safe) but unfriendly.
- **No self-update.** Updating means `git pull`, rebuild, then `devguard install --global`. The agent version is reported to the server and shown on the Devices page, but nothing enforces a minimum version.
- **Uninstall:** `devguard uninstall --global` removes the hook and restores the previous `core.hooksPath`. It leaves the clone, the `devguard` link and the local state folder.
- **Platform:** Linux only (ADR-010); macOS is untested and Windows is out of scope. MDM distribution is post-MVP (ADR-008).
- **Bypass:** the hook is not tamper-proof (`git push --no-verify`, deleting it, a repo-level `core.hooksPath`, other Git clients).

## Options for later (not built)

| Option | Gain | Cost |
|---|---|---|
| Single bundled executable (for example Node SEA or a bundler) | No Node/pnpm needed on the laptop; no path to the clone | Per-OS builds and signing |
| OS packages (`.deb`/`.rpm`, Homebrew, MSI) | One-line install and clean uninstall | Packaging and a repository to host them |
| MDM rollout (Jamf, Intune, Ansible) with the enrollment token delivered securely | Enrolls a whole fleet | Needs the packaged installer first |
| Auto-update with a server-enforced minimum version | Fixes reach laptops; old agents are flagged | Update channel, signing, rollback |
| Optional desktop notification on a block | Visible in IDE-driven pushes | Per-OS code; the terminal text stays the source of truth |

These are suggestions, not commitments; none is implemented.
