-- AlterTable
ALTER TABLE "SecurityEvent" ADD COLUMN     "agentVersion" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "findings" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "wouldBlock" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "destHost" DROP NOT NULL,
ALTER COLUMN "destRepo" DROP NOT NULL,
ALTER COLUMN "mode" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "SecurityEvent_userId_occurredAt_idx" ON "SecurityEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_occurredAt_idx" ON "SecurityEvent"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityEvent_deviceId_idempotencyKey_key" ON "SecurityEvent"("deviceId", "idempotencyKey");

