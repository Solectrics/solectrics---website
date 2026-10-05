-- Supplier documents have a lifecycle before they are assigned to a job or posted.
-- The original PDF lives in the existing R2 job-file bucket and is only copied into
-- job_files as a reference after the user confirms a job.
CREATE TABLE IF NOT EXISTS bookkeeping_supplier_inbox_addresses (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  email_address TEXT NOT NULL COLLATE NOCASE UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id)
);

CREATE TABLE IF NOT EXISTS bookkeeping_job_books (
  job_id INTEGER PRIMARY KEY,
  book_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_by TEXT,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id)
);

CREATE TABLE IF NOT EXISTS bookkeeping_supplier_invoice_inbox (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('zapier','direct_email','manual_upload','email_webhook')),
  sender_email TEXT,
  recipient_email TEXT,
  email_subject TEXT,
  email_message_id TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attachment_name TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/pdf',
  size_bytes INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  supplier_name TEXT,
  supplier_invoice_number TEXT,
  supplier_invoice_date TEXT,
  purchase_order_reference TEXT,
  subtotal_ex_gst REAL,
  gst_amount REAL,
  total_incl_gst REAL,
  allowable_input_gst REAL,
  extraction_status TEXT NOT NULL DEFAULT 'not_run'
    CHECK (extraction_status IN ('not_run','complete','needs_review','failed')),
  extraction_confidence REAL,
  extraction_json TEXT NOT NULL DEFAULT '{}',
  extraction_warnings_json TEXT NOT NULL DEFAULT '[]',
  matching_status TEXT NOT NULL DEFAULT 'needs_matching'
    CHECK (matching_status IN ('needs_matching','matched','ready_to_post','posted','duplicate','rejected')),
  job_id INTEGER,
  suggested_job_ids_json TEXT NOT NULL DEFAULT '[]',
  duplicate_of_id TEXT,
  job_file_id TEXT,
  accounting_transaction_id TEXT,
  user_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (duplicate_of_id) REFERENCES bookkeeping_supplier_invoice_inbox(id),
  FOREIGN KEY (accounting_transaction_id) REFERENCES bookkeeping_transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_inbox_book_status
  ON bookkeeping_supplier_invoice_inbox(book_id, matching_status, received_at);
CREATE INDEX IF NOT EXISTS idx_supplier_invoice_inbox_hash
  ON bookkeeping_supplier_invoice_inbox(book_id, content_sha256);
CREATE INDEX IF NOT EXISTS idx_supplier_invoice_inbox_number
  ON bookkeeping_supplier_invoice_inbox(book_id, supplier_name, supplier_invoice_number);
CREATE INDEX IF NOT EXISTS idx_supplier_invoice_inbox_job
  ON bookkeeping_supplier_invoice_inbox(book_id, job_id, supplier_invoice_date);

CREATE TABLE IF NOT EXISTS bookkeeping_supplier_invoice_events (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  inbox_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (inbox_id) REFERENCES bookkeeping_supplier_invoice_inbox(id)
);
