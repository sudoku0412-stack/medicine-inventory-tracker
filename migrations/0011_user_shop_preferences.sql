-- Last explicitly selected Shop for a signed-in user. The preference is not
-- authority: active-Shop resolution always rechecks the membership join.
CREATE TABLE IF NOT EXISTS user_shop_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS user_shop_preferences_household_id ON user_shop_preferences(household_id);
