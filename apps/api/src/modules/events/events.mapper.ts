import type { SecurityEventEntry } from "@devguard/shared";
import type { EventRecord } from "./events.repository.js";

export function toEventEntry(record: EventRecord, userName: string): SecurityEventEntry {
  return {
    id: record.id,
    occurredAt: record.occurredAt.toISOString(),
    receivedAt: record.receivedAt.toISOString(),
    deviceId: record.deviceId,
    deviceName: record.deviceName,
    userId: record.userId,
    userName,
    projectId: record.projectId,
    projectName: record.projectName,
    destination: record.destHost !== null && record.destRepo !== null ? { host: record.destHost, repoPath: record.destRepo } : null,
    operation: record.operation,
    refs: [...record.refs],
    outcome: record.outcome,
    ruleIds: [...record.ruleIds],
    findings: [...record.findings],
    mode: record.mode,
    wouldBlock: record.wouldBlock,
    policyVersion: record.policyVersion,
    exceptionId: record.exceptionId,
    correlationId: record.correlationId,
    agentVersion: record.agentVersion,
  };
}
