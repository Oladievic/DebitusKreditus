CREATE TABLE loan_servicing (
  application_id TEXT PRIMARY KEY REFERENCES applications(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  version INTEGER NOT NULL CHECK(version>=1),
  data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE TABLE loan_servicing_events (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES loan_servicing(application_id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  version INTEGER NOT NULL CHECK(version>=1),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)),
  response TEXT NOT NULL CHECK(json_valid(response)),
  UNIQUE(application_id,version),
  UNIQUE(application_id,idempotency_key)
);
CREATE TRIGGER servicing_scope_insert BEFORE INSERT ON loan_servicing WHEN NOT EXISTS(
  SELECT 1 FROM applications WHERE id=NEW.application_id AND organization_id=NEW.organization_id AND status='funded'
) OR json_extract(NEW.data,'$.applicationId')<>NEW.application_id OR json_extract(NEW.data,'$.version')<>NEW.version BEGIN
  SELECT RAISE(ABORT, 'SERVICING_SCOPE_MISMATCH');
END;
CREATE TRIGGER servicing_scope_update BEFORE UPDATE ON loan_servicing WHEN NEW.application_id<>OLD.application_id OR NEW.organization_id<>OLD.organization_id OR NEW.version<>OLD.version+1 OR json_extract(NEW.data,'$.applicationId')<>NEW.application_id OR json_extract(NEW.data,'$.version')<>NEW.version BEGIN
  SELECT RAISE(ABORT, 'SERVICING_VERSION_MISMATCH');
END;
CREATE TRIGGER servicing_event_scope BEFORE INSERT ON loan_servicing_events WHEN NOT EXISTS(
  SELECT 1 FROM loan_servicing WHERE application_id=NEW.application_id AND organization_id=NEW.organization_id AND version=NEW.version
) BEGIN
  SELECT RAISE(ABORT, 'SERVICING_EVENT_SCOPE_MISMATCH');
END;
CREATE TRIGGER servicing_event_no_replace BEFORE INSERT ON loan_servicing_events WHEN EXISTS(
  SELECT 1 FROM loan_servicing_events WHERE id=NEW.id OR rowid=NEW.rowid OR (application_id=NEW.application_id AND (version=NEW.version OR idempotency_key=NEW.idempotency_key))
) BEGIN
  SELECT RAISE(ABORT, 'SERVICING_EVENT_APPEND_ONLY');
END;
CREATE TRIGGER servicing_event_no_update BEFORE UPDATE ON loan_servicing_events BEGIN
  SELECT RAISE(ABORT, 'SERVICING_EVENT_APPEND_ONLY');
END;
CREATE TRIGGER servicing_event_no_delete BEFORE DELETE ON loan_servicing_events BEGIN
  SELECT RAISE(ABORT, 'SERVICING_EVENT_APPEND_ONLY');
END;
CREATE TRIGGER servicing_no_replace BEFORE INSERT ON loan_servicing WHEN EXISTS(
  SELECT 1 FROM loan_servicing WHERE application_id=NEW.application_id OR rowid=NEW.rowid
) BEGIN
  SELECT RAISE(ABORT, 'SERVICING_NO_REPLACE');
END;
CREATE TRIGGER servicing_no_delete BEFORE DELETE ON loan_servicing BEGIN
  SELECT RAISE(ABORT, 'SERVICING_NO_DELETE');
END;
