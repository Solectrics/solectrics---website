-- Additive only. Apply to jobhub-staging after 0021; no production execution.
ALTER TABLE jobs ADD COLUMN handover_checklist_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE jobs ADD COLUMN handover_notes TEXT;
ALTER TABLE job_tasks ADD COLUMN contact_date TEXT;
ALTER TABLE job_tasks ADD COLUMN contact_notes TEXT;
ALTER TABLE job_tasks ADD COLUMN outstanding_issues TEXT;
