# Using DevGuard

DevGuard is a safety net against **mistaken pushes**. A Git hook on each laptop blocks a push of a protected project to a place it should not go, or one that contains a secret or a prohibited file. Everything is controlled from a dashboard, and every decision is recorded.

This page is for the people who run it. To try it out step by step, see [testing/how-to-test.md](testing/how-to-test.md).

> **What it is not.** A developer can bypass the hook (`git push --no-verify`, deleting the hook, a repo-level `core.hooksPath`, another Git client or machine). An event records that the hook saw a push attempt and what it decided. It does not prove data did or did not leave. The secret detector is small, not comprehensive.

## Who does what

| Person | Does | Where |
|---|---|---|
| **Admin** (security admin) | Defines projects, approved destinations and policy. Assigns people. Issues enrollment tokens. Approves exceptions. Watches events and audit. | Dashboard |
| **Developer** | Installs the tool and enrolls their laptop **once**. After that, nothing. | Terminal, one time |

**Team leads.** This build has no team-lead or project-owner role. Whoever you want to run enrollment and monitoring needs an **admin** account ([ADR-014](decisions/ADR-014-mvp-authorization-scope.md)). Admins see all projects.

Protection is configured in the dashboard, not on the laptop. A repo is protected only if it matches a project assigned to that person. A repo that matches nothing is **not** protected.

---

## 1. Install the tool on a laptop

There is no published package yet; you install from this repository. Requirements: Node 22+, pnpm 10+, Git 2.30+.

```bash
git clone <this repository> && cd dev-guard
pnpm install
pnpm --filter @devguard/shared build
pnpm --filter @devguard/policy-engine build
pnpm --filter @devguard/agent build

# put the command on your PATH (any directory on PATH works)
mkdir -p ~/.local/bin
ln -sf "$PWD/apps/agent/dist/main.js" ~/.local/bin/devguard
devguard status        # "Device: not enrolled"
```

Keep the cloned folder in place: the command runs from it.

Installing the command does not change your Git setup. The hook is installed when you enroll (next section). To remove everything later: `devguard uninstall --global` restores your previous Git configuration.

## 2. Enroll a laptop to a project

Enrollment is two steps: the admin prepares the project and a token, then the person on the laptop runs one command.

### Admin: prepare the project (dashboard, once per project)

1. **Projects** -> create the project and choose its sensitivity.
2. Open it. Under **Approved destinations** add the repository URL it may be pushed to, for example `https://github.com/acme/portal`. Any spelling works (`git@github.com:Acme/Portal.git` becomes `github.com/acme/portal`).
3. Under **Canonical repositories** add the same URL. This is how a laptop recognises the project from its remote.
4. Under **Policy**, pick **Enforce** (block) or **Audit only** (allow and record what would have been blocked), check the file patterns and secret rules, then **Save new version**.
5. Under **People covered** tick the people whose laptops should get these rules and **Save people**. Only listed people receive the project.

### Admin: issue an enrollment token (per laptop)

**Devices** -> *Enroll a laptop* -> choose the person -> **Issue token**. Copy it. It is shown once, works once, and expires in 30 minutes.

### Developer: enroll (once)

```bash
echo '<token>' | devguard enroll --server https://devguard.example.com --token-stdin
```

Using `--token-stdin` keeps the token out of shell history. The server must be `https`, except `http://localhost` for local testing.

This registers the laptop, installs the global pre-push hook, and downloads the person's projects. Check it:

```bash
devguard status --check-server
```

You should see `Device: enrolled`, the project under *Cached policies*, `Global hook: installed` and `Server check: reachable, and it accepted this device.`

### After that

- **Policy changes** are picked up automatically at the next push, or run `devguard sync`.
- **Adding a person to a project** (admin, *People covered*) takes effect at their next push or sync. Removing them stops protection the same way.
- **A repo that is not recognised** (for example a fork with no matching remote) can be linked by hand: `devguard register --project <id>` inside the repo.
- **Lost or retired laptop:** admin clicks **Revoke** on the device. It can no longer sync, send events or use exceptions.

## 3. What the developer sees

**Allowed push:** silent.

**Blocked push:**

```
DevGuard blocked this push.
  Project: Portal (confidential, enforce)
  Destination: github.com/personal/fork
  Why:
    - The push destination is not approved for this project.
  To ask for an exception to this destination:
    devguard request-exception --destination https://github.com/personal/fork --reason "why you need it"
  Reference: <uuid>
```

The remote is untouched. A secret in any outgoing commit also blocks, even if a later commit deletes it. The message names the file and rule, never the value.

**Audit-only project:** the push goes through with a note that it would have been blocked in enforce mode.

**Needs a legitimate exception:**

```bash
devguard request-exception --destination <url> --reason "Handing the prototype to the customer"
devguard exception status        # waiting / approved / rejected
```

Then retry the push once an admin approves it. An exception covers **one project and one destination** for a limited time (maximum 72 hours). It never waives secret or prohibited-file blocks.

**Server unreachable:** the last downloaded policy is used. If an enforced project's policy is older than the limit (default 60 minutes), pushes to it are blocked until the server is reachable again; audit-only projects are allowed and recorded. Events queue locally and are delivered later (`devguard sync` forces it).

## 4. Monitor pushes and activity (admin)

Sign in to the dashboard (default `http://localhost:5173` in development).

| Screen | Use it to |
|---|---|
| **Overview** | Pick a period and see counts of blocked, allowed, allowed-by-exception and could-not-check pushes, top rules, blocked pushes per day, recent blocked pushes, pending approvals, exceptions in force, and active, stale and revoked devices. |
| **Events** | Every push attempt a hook reported: time, project, destination, decision, rule. Filter by decision or rule. Paste the **Reference** a developer quotes to find exactly that push. **Details** shows rule, mode, policy version, refs and for secrets the type, file and line (never the value). |
| **Approvals** | Pending exception requests. **Review** -> reason and expiry -> **Approve** or **Reject**. **Revoke approval** ends an active one immediately. |
| **Projects** | Change destinations, policy mode and people. *Detected repositories* shows repos the laptops matched to the project. |
| **Devices** | Which laptops are enrolled, *Last seen*, revoke a device, issue tokens. A laptop that stopped reporting shows an old *Last seen*. |
| **Audit** | Append-only history of every admin change: who, what, before and after. Cannot be edited or deleted. |

Approving an exception needs a **second admin**: nobody can approve their own request.

### Reading an event honestly

- An event says the hook saw a push attempt and made a decision. It does not say data left or did not leave.
- No event can mean no push, a push that skipped the hook (`--no-verify`, another client), a laptop that never enrolled, or events still queued on an offline laptop. Check *Last seen* on **Devices** before concluding anything.

## 5. Quick reference

| Command | Purpose |
|---|---|
| `devguard enroll --server <url> --token-stdin` | One-time enrollment; installs the hook |
| `devguard status [--check-server]` | Local state, hook, cached policies, queued events |
| `devguard sync` | Fetch current policy, deliver queued events |
| `devguard request-exception --destination <url> --reason "<text>"` | Ask for a one-off allowance |
| `devguard exception status [id]` | See your requests |
| `devguard register --project <id>` | Manually link the current repo to a project |
| `devguard uninstall --global` | Remove the hook, restore previous Git setup |

Admin API reference when the API is running: `http://localhost:<port>/docs`.
