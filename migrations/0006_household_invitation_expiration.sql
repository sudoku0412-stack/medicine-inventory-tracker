-- Invitations expire after seven days.  This remains additive because 0005
-- has already been applied to production databases.
ALTER TABLE household_invitations ADD COLUMN expires_at TEXT;
UPDATE household_invitations
  SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+7 days')
  WHERE expires_at IS NULL;
CREATE INDEX IF NOT EXISTS household_invitations_email_expires_at
  ON household_invitations(email, expires_at);
