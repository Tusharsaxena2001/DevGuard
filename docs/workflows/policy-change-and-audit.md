# Workflow: policy change and audit

1. Authorised user edits a project's policy (mode, classification, destinations, prohibited globs). API validates, creates a new immutable `PolicyVersion`, updates the current pointer, writes an `AdminAuditEvent` (actor, action, target, before/after summary).
2. Agents pick up the new version at the next sync; cached version id is included in events so reviewers can see which policy applied.
3. Reviewers browse admin audit history (scope-filtered). No update/delete endpoints exist for audit or event rows.

## Failure cases
Invalid payload => 400 with field errors. Unauthorized scope => 403. Concurrent edits => optimistic version check, 409. Agents on stale version => ADR-004.
