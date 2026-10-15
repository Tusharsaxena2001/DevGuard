# AG-8 Exception request and status (apps/agent)

**Responsibility:** developer-side exception flow; consume server validation at push time.
**Depends on:** AG-5, API-6.

## Contract
- `devguard request-exception --destination <url> --reason <text> [--project <id>]` (project from current repo by default); prints request id.
- `devguard exception status [id]`.
- At push time (when destination unapproved) the agent calls the API's validate endpoint; result feeds `evaluatePush`. Client never fabricates approvals; offline => no exception (ADR-004/007).
## Acceptance
Request created and visible in API; approved => retry push allowed with outcome `exception`; rejected/expired/other-destination => blocked; offline => blocked with explanation.
