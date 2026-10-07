-- Shared Job Hub operations tasks and installation workflow support.
-- Run after migrations 0015-0020. Existing job/customer records are preserved.
ALTER TABLE jobs ADD COLUMN finance_approval_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN equipment_order_reference TEXT;
ALTER TABLE jobs ADD COLUMN equipment_supplier TEXT;
ALTER TABLE jobs ADD COLUMN equipment_invoice_reference TEXT;
ALTER TABLE jobs ADD COLUMN equipment_amount_paid REAL;
ALTER TABLE jobs ADD COLUMN equipment_paid_at TEXT;
ALTER TABLE jobs ADD COLUMN equipment_expected_delivery_date TEXT;
ALTER TABLE jobs ADD COLUMN scaffolding_required TEXT NOT NULL DEFAULT 'to_be_confirmed';
ALTER TABLE jobs ADD COLUMN scaffold_provider TEXT;
ALTER TABLE jobs ADD COLUMN scaffold_quote_cost REAL;
ALTER TABLE jobs ADD COLUMN scaffold_arranged_by TEXT;
ALTER TABLE jobs ADD COLUMN scaffold_booked_at TEXT;
ALTER TABLE jobs ADD COLUMN scaffold_erection_date TEXT;
ALTER TABLE jobs ADD COLUMN scaffold_removal_date TEXT;
ALTER TABLE jobs ADD COLUMN site_access_notes TEXT;
ALTER TABLE jobs ADD COLUMN final_site_verified_at TEXT;
ALTER TABLE jobs ADD COLUMN final_design_confirmed_at TEXT;
ALTER TABLE jobs ADD COLUMN installation_team_confirmed_at TEXT;
ALTER TABLE jobs ADD COLUMN retailer_export_status TEXT NOT NULL DEFAULT 'not_contacted';
ALTER TABLE jobs ADD COLUMN retailer_requirements TEXT;
ALTER TABLE jobs ADD COLUMN retailer_export_completed_at TEXT;
ALTER TABLE jobs ADD COLUMN handover_completed_at TEXT;
ALTER TABLE jobs ADD COLUMN job_closed_at TEXT;

CREATE TABLE job_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  task_key TEXT,
  title TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'Operations',
  category TEXT NOT NULL DEFAULT 'task',
  due_date TEXT,
  assigned_to TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
  is_blocker INTEGER NOT NULL DEFAULT 0 CHECK (is_blocker IN (0,1)),
  blocker_reason TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  event_kind TEXT NOT NULL DEFAULT 'task' CHECK (event_kind IN ('task','milestone')),
  requires_evidence INTEGER NOT NULL DEFAULT 0 CHECK (requires_evidence IN (0,1)),
  evidence_note TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  date_anchor TEXT,
  anchor_offset_days INTEGER,
  date_review_required INTEGER NOT NULL DEFAULT 0 CHECK (date_review_required IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  completed_by TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  UNIQUE (job_id, task_key)
);
CREATE INDEX idx_job_tasks_due_status ON job_tasks(status, due_date);
CREATE INDEX idx_job_tasks_job_status ON job_tasks(job_id, status);
CREATE INDEX idx_job_tasks_assignee_due ON job_tasks(assigned_to, due_date);

CREATE TABLE job_workflow_settings (
  setting_key TEXT PRIMARY KEY,
  days_before_install INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO job_workflow_settings (setting_key, days_before_install) VALUES
 ('vector_check', 30), ('retailer_contact', 21), ('scaffold_check', 14),
 ('equipment_delivery', 7), ('final_readiness', 2);

CREATE TABLE job_scope_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  item_key TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','accepted','deferred','declined')),
  details TEXT,
  costing_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  UNIQUE (job_id, item_key)
);
CREATE INDEX idx_job_scope_items_job_decision ON job_scope_items(job_id, decision);
