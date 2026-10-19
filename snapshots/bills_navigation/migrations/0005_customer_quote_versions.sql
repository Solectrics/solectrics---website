CREATE TABLE IF NOT EXISTS customer_quote_versions (
  id TEXT PRIMARY KEY,
  job_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  snapshot_json TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  issued_at TEXT,
  accepted_at TEXT,
  UNIQUE (job_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_customer_quotes_job_version
  ON customer_quote_versions(job_id, version_number DESC);
