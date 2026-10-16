-- CreateIndex
CREATE INDEX "ExceptionRequest_requesterId_projectId_destHost_destRepo_idx" ON "ExceptionRequest"("requesterId", "projectId", "destHost", "destRepo");

