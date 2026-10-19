-- Keep customer electricity evidence separate and identify detailed usage where possible.
ALTER TABLE job_files ADD COLUMN energy_data_detail TEXT;

CREATE INDEX IF NOT EXISTS idx_job_files_energy_data
  ON job_files(job_id, document_role, energy_data_detail, uploaded_at);
