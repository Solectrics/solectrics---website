-- Additive Mini Fergus migration. Existing Home Energy Check jobs are solar jobs.
ALTER TABLE jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'solar';
ALTER TABLE job_files ADD COLUMN document_role TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_job_type ON jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_job_files_job_role
  ON job_files(job_id, document_role, uploaded_at);
