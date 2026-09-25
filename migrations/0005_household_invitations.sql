-- Invitations are records only. They never grant a membership until a future,
-- explicit acceptance flow verifies the signed-in identity.
CREATE TABLE IF NOT EXISTS household_invitations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role = 'member'),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(household_id, email)
);
CREATE INDEX IF NOT EXISTS household_invitations_household_id ON household_invitations(household_id);
