import type { ExceptionEntry, MetricsSummary, SecurityEventEntry, SessionUser } from "@devguard/shared";

export const ID = {
  admin: "00000000-0000-4000-8000-0000000000a1",
  alice: "00000000-0000-4000-8000-0000000000b1",
  project: "00000000-0000-4000-8000-0000000000c1",
  device: "00000000-0000-4000-8000-0000000000d1",
  event: "00000000-0000-4000-8000-0000000000e1",
  exception: "00000000-0000-4000-8000-0000000000f1",
} as const;

export const admin: SessionUser = { id: ID.admin, email: "admin@example.test", name: "Ada Admin", roles: [{ role: "security_admin", projectId: null }], isAdmin: true };
export const employee: SessionUser = { id: ID.alice, email: "alice@example.test", name: "Alice Employee", roles: [{ role: "employee", projectId: null }], isAdmin: false };

export const event = (over: Partial<SecurityEventEntry> = {}): SecurityEventEntry => ({
  id: ID.event,
  occurredAt: "2026-06-01T12:00:00.000Z",
  receivedAt: "2026-06-01T12:00:01.000Z",
  deviceId: ID.device,
  deviceName: "alice-laptop",
  userId: ID.alice,
  userName: "Alice Employee",
  projectId: ID.project,
  projectName: "Payments",
  destination: { host: "github.com", repoPath: "personal/fork" },
  operation: "push",
  refs: ["refs/heads/main"],
  outcome: "blocked",
  ruleIds: ["destination_not_approved"],
  findings: [],
  mode: "enforce",
  wouldBlock: true,
  policyVersion: 3,
  exceptionId: null,
  correlationId: "corr-0001-abcd",
  agentVersion: "0.1.0",
  ...over,
});

export const metrics = (over: Partial<MetricsSummary> = {}): MetricsSummary => ({
  range: "7d",
  since: "2026-05-25T12:00:00.000Z",
  generatedAt: "2026-06-01T12:00:00.000Z",
  outcomes: { allowed: 40, blocked: 5, error: 1, exception: 2 },
  totalEvents: 48,
  topRules: [{ ruleId: "destination_not_approved", count: 4 }],
  blockedPerDay: [{ day: "2026-06-01", projectId: ID.project, projectName: "Payments", blocked: 3 }],
  exceptions: { pending: 2, inForce: 1 },
  devices: { active: 7, stale: 2, revoked: 1 },
  recentIncidents: [event()],
  ...over,
});

export const exception = (over: Partial<ExceptionEntry> = {}): ExceptionEntry => ({
  id: ID.exception,
  projectId: ID.project,
  projectName: "Payments",
  requesterId: ID.alice,
  requesterName: "Alice Employee",
  deviceId: null,
  destination: { host: "github.com", repoPath: "customer/portal-copy" },
  reason: "Customer asked for a copy in their own repository",
  status: "pending",
  eventId: null,
  createdAt: "2026-06-01T12:00:00.000Z",
  expiresAt: null,
  decisions: [],
  ...over,
});

export const page = <T,>(items: T[]): { items: T[]; total: number; page: number; pageSize: number } => ({ items, total: items.length, page: 1, pageSize: 25 });
