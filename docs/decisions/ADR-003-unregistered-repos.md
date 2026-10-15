# ADR-003: Repos matching no project are not protected

**Status:** accepted (amended by ADR-008: protection is assigned from the dashboard, not by developer registration)
**Decision:** A repo is protected only if it resolves to a project, either by server-defined matching (ADR-008) or by the manual `devguard register` fallback. A repo that matches nothing is allowed without an event or prompt. `devguard status` reports whether a repo is matched and to which project.
**Why:** avoids false blocks on personal and open-source work on the laptop, and avoids surveillance of unrelated activity.
**Consequences:** a confidential repo the agent never matched is unprotected (for example, `git init` locally and push to a personal remote before the canonical URL was ever seen). This is a documented limitation. Mitigations: admin-entered fingerprints, and an "unrecognized repo" report (post-MVP).
