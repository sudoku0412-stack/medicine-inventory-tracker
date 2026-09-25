CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  strength TEXT NOT NULL DEFAULT '',
  form TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity >= 0),
  unit TEXT NOT NULL,
  expiry_date TEXT,
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  low_stock_threshold INTEGER NOT NULL DEFAULT 4 CHECK(low_stock_threshold >= 0),
  photo_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  discarded_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  kind TEXT NOT NULL,
  trigger_date TEXT NOT NULL,
  read_at TEXT,
  pushed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(batch_id, kind, trigger_date)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);
