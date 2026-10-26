CREATE TABLE business_profiles (organization_id TEXT PRIMARY KEY REFERENCES organizations(id), version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), data TEXT NOT NULL);
