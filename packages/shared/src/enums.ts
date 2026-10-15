import { z } from "zod";

export const RoleSchema = z.enum(["employee", "team_lead", "project_owner", "security_admin"]);
export type Role = z.infer<typeof RoleSchema>;

export const ClassificationSchema = z.enum(["internal", "confidential", "client_owned"]);
export type Classification = z.infer<typeof ClassificationSchema>;

export const EnforcementModeSchema = z.enum(["enforce", "audit_only"]);
export type EnforcementMode = z.infer<typeof EnforcementModeSchema>;

export const OutcomeSchema = z.enum(["allowed", "blocked", "error", "exception"]);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const OperationTypeSchema = z.enum(["push", "force_push", "branch_create", "branch_delete", "tag_push"]);
export type OperationType = z.infer<typeof OperationTypeSchema>;

export const DeviceStatusSchema = z.enum(["active", "revoked"]);
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;

export const ExceptionStatusSchema = z.enum(["pending", "approved", "rejected", "expired", "revoked"]);
export type ExceptionStatus = z.infer<typeof ExceptionStatusSchema>;

/** Stable identifiers for the rule that produced a decision. */
export const RuleIdSchema = z.enum([
  "allowed",
  "unprotected_repo",
  "destination_not_approved",
  "prohibited_file",
  "secret_detected",
  "scan_error",
  "policy_unavailable",
  "exception_granted",
  "internal_error",
]);
export type RuleId = z.infer<typeof RuleIdSchema>;
