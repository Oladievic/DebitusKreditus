CREATE TABLE statement_reports (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  document_id TEXT NOT NULL UNIQUE REFERENCES documents(id),
  data TEXT NOT NULL CHECK(json_valid(data))
);
--> statement-breakpoint
CREATE INDEX statement_reports_application ON statement_reports(application_id);
--> statement-breakpoint
CREATE TRIGGER statement_report_scope BEFORE INSERT ON statement_reports WHEN NOT EXISTS(
  SELECT 1 FROM documents JOIN applications ON applications.id=documents.application_id
  WHERE documents.id=NEW.document_id AND documents.application_id=NEW.application_id
    AND documents.organization_id=NEW.organization_id AND applications.organization_id=NEW.organization_id
) BEGIN
  SELECT RAISE(ABORT, 'STATEMENT_SCOPE_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER statement_report_no_replace BEFORE INSERT ON statement_reports WHEN EXISTS(
  SELECT 1 FROM statement_reports WHERE id=NEW.id OR document_id=NEW.document_id OR rowid=NEW.rowid
) BEGIN
  SELECT RAISE(ABORT, 'STATEMENT_APPEND_ONLY');
END;
--> statement-breakpoint
CREATE TRIGGER statement_report_no_update BEFORE UPDATE ON statement_reports BEGIN
  SELECT RAISE(ABORT, 'STATEMENT_APPEND_ONLY');
END;
--> statement-breakpoint
CREATE TRIGGER statement_report_no_delete BEFORE DELETE ON statement_reports BEGIN
  SELECT RAISE(ABORT, 'STATEMENT_APPEND_ONLY');
END;
--> statement-breakpoint
CREATE TRIGGER statement_source_no_update BEFORE UPDATE ON documents WHEN EXISTS(SELECT 1 FROM statement_reports WHERE document_id=OLD.id) BEGIN
  SELECT RAISE(ABORT, 'STATEMENT_SOURCE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER statement_source_no_delete BEFORE DELETE ON documents WHEN EXISTS(SELECT 1 FROM statement_reports WHERE document_id=OLD.id) BEGIN
  SELECT RAISE(ABORT, 'STATEMENT_SOURCE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER statement_source_no_replace BEFORE INSERT ON documents WHEN EXISTS(
  SELECT 1 FROM statement_reports JOIN documents ON documents.id=statement_reports.document_id
  WHERE documents.id=NEW.id OR documents.rowid=NEW.rowid
) BEGIN
  SELECT RAISE(ABORT, 'STATEMENT_SOURCE_IMMUTABLE');
END;
