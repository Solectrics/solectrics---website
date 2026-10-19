CREATE TABLE IF NOT EXISTS job_work_logs (
  id TEXT PRIMARY KEY,
  job_id INTEGER NOT NULL,
  work_date TEXT NOT NULL,
  hours REAL NOT NULL,
  supervisor TEXT,
  supervision_type TEXT NOT NULL,
  competency TEXT NOT NULL,
  work_completed TEXT NOT NULL,
  tests_results TEXT,
  issues_notes TEXT,
  supervisor_notes TEXT,
  start_time TEXT,
  finish_time TEXT,
  materials_used TEXT,
  certification_status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE job_work_logs ADD COLUMN work_dates TEXT;
ALTER TABLE job_work_logs ADD COLUMN days REAL NOT NULL DEFAULT 1;
