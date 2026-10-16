# AG-8 Exception request and status (apps/agent)

**Responsibility:** developer-side exception flow; consume server validation at push time.
**Depends on:** AG-5, API-6.

## Contract
- `devguard request-exception --destination <url> --reason <text> [--project <id>]` (project from current repo by default); prints request id.
- `devguard exception status [id]`.
- At push time (when destination unapproved) the agent calls the API's validate endpoint; result feeds `evaluatePush`. Client never fabricates approvals; offline => no exception (ADR-004/007).
## Acceptance
Request created and visible in API; approved => retry push allowed with outcome `exception`; rejected/expired/other-destination => blocked; offline => blocked with explanation.

## Implemented (apps/agent)
- **Commands:** `devguard request-exception --destination <url> --reason <text> [--project <id>]` (project from the current repo when it matches exactly one, else `--project` is required and the candidates are listed); `devguard exception status [id]` (own requests and decisions; `--json` supported). Nothing prints a token: the destination is sent only in its canonical `https://host/path` form, never as typed (a remote URL can carry a token as its username).
- **Block message:** a push blocked because of the destination ends with a ready command: `devguard request-exception --project <id> --destination https://host/path --reason "why you need it"`.
- **Push time** (`use-cases/check-exception.ts`, called by the runner): only when the destination is what blocks, the hook asks `POST /agent/exceptions/validate` (3 s, one attempt) for the project and canonical destination. A clear "valid" answer is turned into a `ValidException` and the **policy engine re-evaluates** (it re-checks project, destination, approver != requester and expiry with the local clock, so a wrong or stale server answer cannot let a push through). The event is recorded as outcome `exception` with the exception id; the id and approver are shown in the message. Anything else (no exception, server unreachable or erroring, a throw) leaves the block in place; offline adds "an approved exception could not be checked because the DevGuard server is unreachable" (ADR-004/007). Content findings (secrets, prohibited files) are never waived.
- **Stubs removed:** no planned-command stubs remain (`planned.ts` deleted).
- **Tests:** use cases (project resolution, canonical destination, no credential in the request, refusal before any network call), runner integration (valid, none, unavailable, throwing, engine refusals for wrong destination/project/expired/self-approved/revoked, secrets not waived, command hint only for destination blocks), CLI output including hostile server text, client calls, and real-hook e2e against the stub API (request, approval, retry succeeds as outcome `exception` and is delivered; secret still blocks; offline blocks with the explanation; approved destinations never ask).
- **Security review:** independent read-only review found no critical/high issues. Fixed: the agent ignores any `waivedRuleIds` in the server's answer and always passes an empty list to the engine (an exception covers the destination only; waiving secrets would need an explicit feature). Accepted: scope (project, destination) comes from the local request and the server's exact-match query, not from the reply; the engine independently re-checks expiry and approver != requester.
- **Known gaps:** an exception can be used for every push until it expires; the agent cannot show an offline user what is approved (it cannot ask); `exception status` needs the server.
