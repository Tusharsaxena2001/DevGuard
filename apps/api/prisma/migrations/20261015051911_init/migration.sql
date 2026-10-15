-- CreateEnum
CREATE TYPE "Role" AS ENUM ('employee', 'team_lead', 'project_owner', 'security_admin');

-- CreateEnum
CREATE TYPE "Classification" AS ENUM ('internal', 'confidential', 'client_owned');

-- CreateEnum
CREATE TYPE "EnforcementMode" AS ENUM ('enforce', 'audit_only');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('allowed', 'blocked', 'error', 'exception');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('push', 'force_push', 'branch_create', 'branch_delete', 'tag_push');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('active', 'revoked');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "DestinationType" AS ENUM ('exact', 'owner_wildcard');

-- CreateEnum
CREATE TYPE "DecisionKind" AS ENUM ('approved', 'rejected', 'revoked');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "projectId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'active',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrollmentToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "classification" "Classification" NOT NULL,
    "ownerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoRegistration" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "repoFingerprint" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepoRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovedDestination" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "host" TEXT NOT NULL,
    "repoPath" TEXT NOT NULL,
    "type" "DestinationType" NOT NULL DEFAULT 'exact',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovedDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "mode" "EnforcementMode" NOT NULL,
    "prohibitedGlobs" TEXT[],
    "secretRules" JSONB NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionRequest" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "requesterId" UUID NOT NULL,
    "deviceId" UUID,
    "destHost" TEXT NOT NULL,
    "destRepo" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'pending',
    "eventId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExceptionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionDecision" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "deciderId" UUID NOT NULL,
    "decision" "DecisionKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExceptionDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "deviceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID,
    "destHost" TEXT NOT NULL,
    "destRepo" TEXT NOT NULL,
    "operation" "OperationType" NOT NULL,
    "ruleIds" TEXT[],
    "mode" "EnforcementMode" NOT NULL,
    "outcome" "Outcome" NOT NULL,
    "correlationId" TEXT NOT NULL,
    "policyVersion" INTEGER,
    "exceptionId" UUID,
    "approverId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditEvent" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "summary" JSONB NOT NULL,

    CONSTRAINT "AdminAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_projectId_idx" ON "Membership"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_role_projectId_key" ON "Membership"("userId", "role", "projectId");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentToken_tokenHash_key" ON "EnrollmentToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EnrollmentToken_userId_idx" ON "EnrollmentToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_name_key" ON "Project"("name");

-- CreateIndex
CREATE INDEX "RepoRegistration_projectId_idx" ON "RepoRegistration"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "RepoRegistration_deviceId_repoFingerprint_key" ON "RepoRegistration"("deviceId", "repoFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovedDestination_projectId_host_repoPath_key" ON "ApprovedDestination"("projectId", "host", "repoPath");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_projectId_key" ON "Policy"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_projectId_version_key" ON "PolicyVersion"("projectId", "version");

-- CreateIndex
CREATE INDEX "ExceptionRequest_projectId_status_idx" ON "ExceptionRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "ExceptionDecision_requestId_idx" ON "ExceptionDecision"("requestId");

-- CreateIndex
CREATE INDEX "SecurityEvent_projectId_occurredAt_idx" ON "SecurityEvent"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_deviceId_occurredAt_idx" ON "SecurityEvent"("deviceId", "occurredAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_outcome_idx" ON "SecurityEvent"("outcome");

-- CreateIndex
CREATE INDEX "SecurityEvent_correlationId_idx" ON "SecurityEvent"("correlationId");

-- CreateIndex
CREATE INDEX "AdminAuditEvent_occurredAt_idx" ON "AdminAuditEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AdminAuditEvent_targetType_targetId_idx" ON "AdminAuditEvent"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentToken" ADD CONSTRAINT "EnrollmentToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoRegistration" ADD CONSTRAINT "RepoRegistration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoRegistration" ADD CONSTRAINT "RepoRegistration_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovedDestination" ADD CONSTRAINT "ApprovedDestination_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "ExceptionRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "ExceptionRequest_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionDecision" ADD CONSTRAINT "ExceptionDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ExceptionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Postgres treats NULLs as distinct, so @@unique([userId, role, projectId]) does not stop duplicate global roles.
CREATE UNIQUE INDEX "Membership_userId_role_global_key" ON "Membership" ("userId", "role") WHERE "projectId" IS NULL;

-- Append-only / immutable history (security invariant 9): even a buggy service cannot rewrite these rows.
CREATE FUNCTION devguard_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on "%" is not allowed: rows are append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AdminAuditEvent_append_only"
  BEFORE UPDATE OR DELETE ON "AdminAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION devguard_reject_mutation();

CREATE TRIGGER "PolicyVersion_immutable"
  BEFORE UPDATE OR DELETE ON "PolicyVersion"
  FOR EACH ROW EXECUTE FUNCTION devguard_reject_mutation();
