PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE users_next (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('client','bank','admin')), organization_id TEXT REFERENCES organizations(id), password_hash TEXT NOT NULL, password_salt TEXT NOT NULL);
--> statement-breakpoint
INSERT INTO users_next SELECT id,email,name,role,organization_id,password_hash,password_salt FROM users;
--> statement-breakpoint
DROP TABLE users;
--> statement-breakpoint
ALTER TABLE users_next RENAME TO users;
--> statement-breakpoint
CREATE TABLE product_intake (product_id TEXT PRIMARY KEY, paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)), reason TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, updated_by TEXT REFERENCES users(id));
--> statement-breakpoint
CREATE TABLE document_ocr (document_id TEXT PRIMARY KEY REFERENCES documents(id), data TEXT NOT NULL);
--> statement-breakpoint
PRAGMA defer_foreign_keys = OFF;
