CREATE TABLE IF NOT EXISTS email_logs (
  id TEXT PRIMARY KEY,
  job_id INTEGER NOT NULL,
  email_type TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL,
  included_json TEXT,
  missing_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_logs_job_created
  ON email_logs(job_id, created_at);
