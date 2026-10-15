# ADR-008: Protection is configured from the dashboard; the laptop only obeys

**Status:** accepted
**Context:** Requiring developers to register each repo and install a hook per repo is a manual, human-dependent step that undermines the guardrail.
**Decision:**
1. **Who configures what.** Admins and leads, in the dashboard, define projects, classification, mode, canonical repo(s), approved destinations, and employee/team assignments. Developers do a one-time agent install and enrollment (token issued from the dashboard; MDM distribution is post-MVP). No per-project or per-repo developer steps.
2. **Global hook.** At enrollment the agent sets a global `core.hooksPath` to a managed directory containing the DevGuard `pre-push` wrapper. It runs for every repo and chains to the repo's own `.git/hooks/pre-push` if present. A repo-level `core.hooksPath` (e.g. husky) overrides the global one; `devguard status` and heartbeats report this, but it cannot be prevented.
3. **Repo-to-project matching.** The remote URL is not a reliable identity (the incident is a changed remote), so identification works in two steps:
   - A local repo with any remote matching a project's canonical repo or approved destination is matched to that project. The agent computes the repo's root commit hash(es) and reports them; the server stores them as that project's fingerprints.
   - Afterwards, matching uses fingerprints from the synced policy, so rewiring `origin` to a personal repo still resolves to the same project and is blocked.
   Fingerprints reported by a device are attributed to that device and visible/removable in the dashboard; admins may also enter fingerprints manually.
4. **Sync.** The agent syncs all projects assigned to the enrolled employee (policy, destinations, mode, fingerprints). The server remains authoritative; offline behavior per ADR-004.
5. **Fallback.** Manual `devguard register` stays for repos the agent cannot match; it is validated server-side (the device's user must be assigned to the project) and shown in the dashboard.
**Consequences:** better coverage with no developer work; new risk that a device reports a bogus fingerprint, which can only cause its own repo to be treated as that project (stricter, not looser), but is reviewable. Gate 1 (offline, local policy file, manual register) is unchanged.
