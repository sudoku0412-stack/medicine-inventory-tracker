-- One local household profile. This is intentionally independent of medicine rows.
CREATE TABLE IF NOT EXISTS profile_settings (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  display_name TEXT NOT NULL,
  household_name TEXT NOT NULL,
  default_storage_location TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
