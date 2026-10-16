# ADR-004: Offline and stale-policy behavior for protected repos

**Status:** accepted
**Decision:** The agent caches the last synced policy per project with a fetch timestamp. On each push:
1. Server reachable: sync/validate; use fresh policy.
2. Unreachable, cache age <= `DEVGUARD_POLICY_MAX_STALE_MINUTES` (default 60): evaluate with cached policy; destination allowlist and content rules still apply; exceptions cannot be validated offline (treated as absent).
3. Unreachable and cache too old or missing: `enforce` mode => **block** with a message explaining why; `audit-only` => allow and write a local record queued for delivery.
Events that cannot be delivered are spooled locally and retried; delivery failure never changes the push decision by itself.
**Why:** never silently fail open for protected projects, while bounding disruption.
**Consequences:** developers offline beyond TTL on enforced projects are blocked until reconnect (override only through server-side exception when online). Mode used is the cached project mode; a missing cache for a registered repo is treated as enforce.

**Implementation note (AG-6):** the TTL is now evaluated. Policies synced from the server carry `source: "server"` and age per the rules above (`fresh` <= 5 min, `stale_ok` <= `DEVGUARD_POLICY_MAX_STALE_MINUTES`, otherwise `expired`; an unparsable or future timestamp is `expired`). A locally supplied policy (`register --policy-file`, no server) never ages. Before deciding, the hook tries a short sync; a failed sync changes nothing.

**Implementation note (AG-3, ADR-011, superseded for server policies by the note above):** the TTL (point 2/3) is not evaluated yet: it requires a server to be unreachable, and policy sync arrives with AG-5/AG-6. Until then a cached policy's age is ignored (a test pins this). State the hook cannot read, and a registered repo without a usable policy, block (point 3's "missing cache => enforce").
