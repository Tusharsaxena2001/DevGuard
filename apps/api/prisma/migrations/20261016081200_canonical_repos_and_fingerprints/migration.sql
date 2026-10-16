-- CreateEnum
CREATE TYPE "FingerprintSource" AS ENUM ('device', 'manual');

-- CreateTable
CREATE TABLE "CanonicalRepo" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "host" TEXT NOT NULL,
    "repoPath" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanonicalRepo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFingerprint" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" "FingerprintSource" NOT NULL,
    "reportedByDeviceId" UUID,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalRepo_projectId_host_repoPath_key" ON "CanonicalRepo"("projectId", "host", "repoPath");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFingerprint_projectId_fingerprint_key" ON "ProjectFingerprint"("projectId", "fingerprint");

-- AddForeignKey
ALTER TABLE "CanonicalRepo" ADD CONSTRAINT "CanonicalRepo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFingerprint" ADD CONSTRAINT "ProjectFingerprint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
