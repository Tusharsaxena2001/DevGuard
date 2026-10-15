# Workflow: exception request and approval

1. Push is blocked; the message includes the destination and a ready command.
2. Developer: `devguard request-exception --project <id> --destination <url> --reason "..."`. API normalizes destination, creates `pending` request linked to the blocking event.
3. Authorised approver (lead/owner in project, or security_admin; not the requester) reviews in dashboard: approve with scope (project + destination), reason, expiry (<= cap), or reject with reason.
4. Developer retries `git push`. Agent asks API to validate an exception for (device, project, destination). If valid and unexpired => allow with outcome `exception` and approver reference; otherwise block as before.
5. Expiry/revocation enforced on the server at each validation. Everything writes an admin audit event.

## Failure cases
Self-approval => 403. Out-of-scope role/project => 403/404. Expired/revoked => block. Destination differs from the approved one => block. Offline => cannot validate, blocked per ADR-004. Content findings are not waived (ADR-007).
