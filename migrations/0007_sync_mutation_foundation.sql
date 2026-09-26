-- Online mutation foundation for household inventory sync. D1 stays the
-- source of truth; this does not add offline queues or a change feed.
ALTER TABLE batches ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS mutation_receipts (
  household_id TEXT NOT NULL REFERENCES households(id),
  operation_id TEXT NOT NULL,
  batch_id TEXT,
  operation TEXT NOT NULL CHECK(operation IN ('create','update','consume','discard')),
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (household_id, operation_id)
);

CREATE INDEX IF NOT EXISTS mutation_receipts_household_created_at
  ON mutation_receipts(household_id, created_at);
