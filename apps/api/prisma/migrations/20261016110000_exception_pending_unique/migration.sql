-- One pending request per requester, project and destination. A partial unique index (Prisma cannot express it in the
-- schema file) backs up the application check against concurrent requests.
CREATE UNIQUE INDEX "ExceptionRequest_one_pending_per_scope"
  ON "ExceptionRequest" ("requesterId", "projectId", "destHost", "destRepo")
  WHERE "status" = 'pending';
