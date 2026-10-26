PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, data TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('client','bank')), organization_id TEXT REFERENCES organizations(id), password_hash TEXT NOT NULL, password_salt TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS applications_org ON applications(organization_id, updated_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(id), organization_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL, category TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, content TEXT NOT NULL, synthetic INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS documents_application ON documents(application_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, organization_id TEXT REFERENCES organizations(id), application_id TEXT REFERENCES applications(id), actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_application ON audit(application_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS preferences (user_id TEXT PRIMARY KEY REFERENCES users(id), data TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS import_previews (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL, expires_at TEXT NOT NULL, applied_at TEXT);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS integration_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS action_receipts (application_id TEXT NOT NULL REFERENCES applications(id), action TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(application_id, action));
