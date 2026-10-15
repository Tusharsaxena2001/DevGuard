# ADR-005: Minimal built-in secret detector (Gitleaks not used for MVP)

**Status:** accepted
**Decision:** Implement a small detector in `policy-engine` for high-confidence patterns (private key blocks, AWS access key IDs, GitHub/Slack tokens, similar prefixed tokens) plus prohibited-file globs (`.env`, `*.pem`, `id_rsa`, etc.). Gitleaks is not installed on the dev machine and introduces a binary dependency; revisit post-MVP via an adapter interface.
**Why:** reliable, testable, installable everywhere in the time box.
**Consequences:** coverage is limited and must be documented as such; never described as comprehensive. Findings report rule id + file path (+ commit sha), never matched content. The agent feeds added lines (not whole files) of outgoing commits to the detector in-process.
