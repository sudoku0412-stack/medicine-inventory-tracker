-- Additive tenant foundation. Existing rows stay intact until the explicitly
-- configured first owner claims this cabinet after a verified Access login.
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS households (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  email TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (provider, subject)
);
CREATE TABLE IF NOT EXISTS memberships (
  household_id TEXT NOT NULL REFERENCES households(id), user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('owner','member')), created_at TEXT NOT NULL,
  PRIMARY KEY (household_id, user_id)
);
CREATE TABLE IF NOT EXISTS tenant_bootstrap (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1), household_id TEXT NOT NULL REFERENCES households(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS household_settings (
  household_id TEXT PRIMARY KEY REFERENCES households(id), display_name TEXT NOT NULL,
  household_name TEXT NOT NULL, default_storage_location TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE batches ADD COLUMN household_id TEXT REFERENCES households(id);
ALTER TABLE notifications ADD COLUMN household_id TEXT REFERENCES households(id);
ALTER TABLE push_subscriptions ADD COLUMN household_id TEXT REFERENCES households(id);
ALTER TABLE push_subscriptions ADD COLUMN user_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS batches_household_id ON batches(household_id);
CREATE INDEX IF NOT EXISTS notifications_household_id ON notifications(household_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_household_id ON push_subscriptions(household_id);
