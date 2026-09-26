-- Append-only security-relevant Shop access events. Target identifiers are
-- verified identity subjects or normalized invitation email addresses only.
CREATE TABLE IF NOT EXISTS access_audit (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL CHECK(event IN ('bootstrap','invite_created','invite_accepted','invite_revoked')),
  household_id TEXT NOT NULL REFERENCES households(id),
  actor_user_id TEXT REFERENCES users(id),
  target_identifier TEXT NOT NULL,
  created_at TEXT NOT NULL,
  request_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS access_audit_household_created_at ON access_audit(household_id, created_at);
