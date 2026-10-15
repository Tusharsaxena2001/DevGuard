# ADR-007: Exception (approval) semantics

**Status:** accepted
**Decision:** An exception is scoped to exactly one project + one normalized destination, has a reason, an `expiresAt` (server cap `EXCEPTION_MAX_TTL_HOURS`), and states `pending | approved | rejected | expired | revoked`. Approver must hold lead/owner role in that project or be security_admin, and must differ from the requester. The hook never waits for approval: developer requests, waits for the dashboard decision, retries. During the retry the agent asks the API whether a valid exception exists for (device, project, destination); the API evaluates, the client claim is ignored. Content findings (secrets/prohibited files) are not waived by destination exceptions unless the exception explicitly lists the rule id.
**Why:** prevents permanent unrestricted access and client-side forgery.
**Consequences:** offline retries cannot use exceptions (ADR-004). Every decision writes an admin audit event.
