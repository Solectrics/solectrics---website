CREATE TABLE IF NOT EXISTS customer_invoice_versions (
  id TEXT PRIMARY KEY,
  job_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  snapshot_json TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  issued_at TEXT,
  paid_at TEXT,
  voided_at TEXT,
  UNIQUE (job_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_customer_invoices_job_version
  ON customer_invoice_versions(job_id, version_number DESC);
