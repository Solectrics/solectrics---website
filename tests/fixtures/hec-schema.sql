-- Synthetic baseline-compatible HEC tables; no customer data.
PRAGMA foreign_keys=ON;
CREATE TABLE enquiries (   id INTEGER PRIMARY KEY AUTOINCREMENT,   enquiry_ref TEXT UNIQUE NOT NULL,   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,    customer_name TEXT,   email TEXT,   phone TEXT,   address TEXT,    answers_json TEXT NOT NULL,    summer_bill_file TEXT,   winter_bill_file TEXT,    opensolar_status TEXT NOT NULL DEFAULT 'not_created',   opensolar_project_id TEXT,    job_status TEXT NOT NULL DEFAULT 'enquiry',   notes TEXT );
CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, enquiry_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, job_status TEXT DEFAULT 'new_enquiry', next_action TEXT, job_type TEXT NOT NULL DEFAULT 'solar', FOREIGN KEY(enquiry_id) REFERENCES enquiries(id));
CREATE TABLE job_files (
    id TEXT PRIMARY KEY,
    job_id INTEGER NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    content_type TEXT,
    size_bytes INTEGER NOT NULL,
    category TEXT NOT NULL,
    caption TEXT,
    uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  , document_role TEXT, energy_data_detail TEXT);