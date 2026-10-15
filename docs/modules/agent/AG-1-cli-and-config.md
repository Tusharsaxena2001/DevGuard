# AG-1 CLI skeleton and local config (apps/agent)

**Responsibility:** `devguard` CLI entry (commander), command registry, local state store.
**Depends on:** SH-1.

## Contract
- Commands (stubs grow per module): `enroll`, `register`, `install`, `uninstall`, `status`, `request-exception`, `hook pre-push` (internal), `sync`.
- Config dir `~/.config/devguard` (override `DEVGUARD_HOME` for tests): `config.json` (server URL, device id), `credentials.json` (device secret, mode 0600), `repos.json` (registered repos -> project), `policies/<project>.json` (cache + fetchedAt), `spool/` (pending events).
- All files validated with Zod on read; atomic writes; permission check on credentials (refuse if group/world readable).
- Exit codes: 0 ok, 1 blocked, 2 usage/config error.
## Security
Never print secrets; `--json` output option; no network in this module.
## Structure (docs/architecture/engineering-standards.md)
`src/main.ts` (composition root), `cli/` (thin commands), `use-cases/`, `ports/` (GitPort, ConfigStore, ApiClient, Clock, Logger), `adapters/` (fs-store here; others in later modules), `presentation/`. ESLint boundary rules defined in this module.
## Implemented semantics (apps/agent)
- **Commands:** `status` works (`--json` supported, global option). `enroll`, `register`, `install`, `uninstall`, `request-exception`, `sync` and the hidden `hook pre-push` are stubs: `'devguard <cmd>' is not available in this build yet.`, exit 2. Commander errors map to exit 2; help is exit 0; unexpected errors print a generic message, exit 2 (never Node's default 1, which is reserved for "blocked").
- **Status:** reports enrolled/healthy, server URL, device id, per-file state (`ok|missing|invalid|insecure_permissions|unreadable`), repo count, cache state and per-project policy fetch time. No field can carry a secret. Exit 2 if any file is invalid/insecure/unreadable; a fresh, unenrolled device is healthy (exit 0). A config/credentials pair naming different device ids is reported invalid.
- **Store (`adapters/fs-store`):** state dir = `$DEVGUARD_HOME` (must be absolute, else exit 2) or `~/.config/devguard`; nothing is created until the first write. Writes validate first, then write a `0600` temp file in the same directory, fsync and rename; the state dir and `policies/` are created `0700`. Write failures throw `AgentError("store_write_failed")` with no contents in the message.
- **Trust checks before any read** (POSIX): the state dir (and `policies/`) must be a directory owned by the current user and not group/world writable; a file must be a regular file (opened `O_NOFOLLOW | O_NONBLOCK`, checked with `fstat` on the handle, so a symlink, FIFO or swapped file is refused without hanging), owned by the user, and not group/world writable. Credentials must additionally not be group/world readable (`& 0o077`). Permissions are checked before the content is parsed. Refusals are `insecure_permissions`. Note: a default umask of 002 (common on Linux) makes `mkdir` create `0775` directories, which the store refuses, so the agent always creates its own with `0700`.
- **Validation:** every file is parsed with a strict Zod schema; malformed, unreadable or oversized (> 8 MiB) files are `invalid`/`unreadable`, never "missing". `serverUrl` must be `https` (plain `http` only for `localhost`, `127.0.0.1`, `[::1]`) with no credentials, query or fragment, because the device secret and enrollment token are sent there and the URL is displayed.
- **Policy cache:** file name = project id, restricted to `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`; a cache file must contain the project it is named after. `listPolicyIds` returns an error (not an empty list) if the directory cannot be read, and lists every `.json` name so oddly named files surface as `invalid`.
- **Boundaries (ESLint, `eslint.config.js`):** `cli/` cannot import adapters or node I/O; `use-cases/`, `ports/`, `presentation/` cannot import adapters, the CLI, commander or node I/O (Git only through a future `GitPort`); `adapters/` cannot import cli/use-cases/commander; dynamic `import()` is banned in layered folders; nothing in `apps/agent` imports another app; `packages/*` never import apps and `shared` imports no other DevGuard package. `main.ts` is the composition root. Boundary tests lint virtual files with the real config.
- **Deferred:** ports `GitPort`, `ApiClient`, `Clock` and the `spool/` directory land with the modules that use them (AG-3, AG-5, AG-6/7). A small `Result` type is duplicated from policy-engine; consolidate when AG-3 needs both.
## Known limitations
- Linux only for the MVP (ADR-010): built and tested on Linux. macOS is untested (POSIX, expected to work). On Windows the permission, ownership and symlink checks do nothing; Windows is out of scope.
- Local state is readable by the same OS user (ADR-006); the checks stop other users and planted files, not the user themselves or root.
- `DEVGUARD_HOME` is honoured in production. Anyone who can set the hook's environment can point it at empty state, so **AG-3 must treat "hook installed but no usable state" as a block in enforce mode** (see AG-3). `--no-verify` already bypasses the hook entirely.
- Not covered by an automated test: the file-ownership check (needs a second user) and crash-atomicity of the rename. Directory/file mode checks, FIFO, symlink and size cases are tested.
## Acceptance
Structure and boundaries above followed and enforced by lint; `devguard --help` works without server; config round-trips; wrong permissions detected; `DEVGUARD_HOME` isolation in tests.
**Verified:** 170 tests in `apps/agent` (real temp directories for the store; the real `main.ts` run in-process with sandboxed `HOME`/`DEVGUARD_HOME`; ESLint boundary tests), plus a manual run of the built CLI. The whole suite runs in a sandbox `HOME`, so no test can touch a real `~/.config/devguard`. Mutation-checked (permission masks, FIFO open flag, directory trust, serverUrl rules, id-mismatch, listing errors, lint rules); independent security and test reviews done and addressed.
