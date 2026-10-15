---
name: security-review
description: Review a DevGuard change against the threat model, authorization, destination-validation, secret-handling, failure-mode and audit requirements. Reports concrete findings with severity and files. Use for any security-sensitive change.
argument-hint: [module-id or path]
context: fork
agent: security-reviewer
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git status:*), Bash(git log:*)
---

# Security review

Target: `$ARGUMENTS` (module ID, path, or the current diff if empty).

Read `.claude/rules/security.md`, `docs/architecture/security-model.md`, the relevant module spec, then the changed code. Work through `checklist.md` (adjacent). Review only; do not edit files.

Output format:
```
## Findings
- [SEVERITY critical|high|medium|low] <title> — <file>:<line>
  Impact / how it can be exploited or bypassed
  Fix recommendation
## Verified-safe areas
## Not reviewed / assumptions
```
Report only concrete, evidenced issues; say "no findings" per area when clean. Do not speculate without a code path.
