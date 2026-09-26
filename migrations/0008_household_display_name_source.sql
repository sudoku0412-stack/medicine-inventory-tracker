-- Existing settings may already be deliberate choices, including the legacy
-- default text. Treat all of them as user-owned; only newly created rows are
-- eligible to be seeded from a verified Access identity.
ALTER TABLE household_settings ADD COLUMN display_name_source TEXT NOT NULL DEFAULT 'user'
  CHECK(display_name_source IN ('default', 'identity_seed', 'user'));
