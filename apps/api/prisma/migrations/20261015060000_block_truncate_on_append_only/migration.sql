-- Row-level triggers do not fire on TRUNCATE, so block it explicitly.
CREATE TRIGGER "AdminAuditEvent_no_truncate"
  BEFORE TRUNCATE ON "AdminAuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION devguard_reject_mutation();

CREATE TRIGGER "PolicyVersion_no_truncate"
  BEFORE TRUNCATE ON "PolicyVersion"
  FOR EACH STATEMENT EXECUTE FUNCTION devguard_reject_mutation();
