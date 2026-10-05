-- Additive bookkeeping foundation. Existing Job Hub operational records are preserved.
-- A book is an accounting boundary (for example, a future Solectrics or Sol Espresso ledger).
CREATE TABLE IF NOT EXISTS bookkeeping_books (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  legal_name TEXT,
  currency TEXT NOT NULL DEFAULT 'NZD',
  gst_registered INTEGER NOT NULL DEFAULT 0,
  gst_number TEXT,
  gst_basis TEXT NOT NULL DEFAULT 'unconfigured'
    CHECK (gst_basis IN ('payments', 'invoice', 'hybrid', 'unconfigured')),
  gst_rate REAL NOT NULL DEFAULT 0.15,
  commencement_date TEXT,
  historical_label TEXT NOT NULL DEFAULT 'Historical / Hnry',
  company_tax_rate REAL NOT NULL DEFAULT 0.28,
  company_tax_enabled INTEGER NOT NULL DEFAULT 0,
  income_tax_method TEXT NOT NULL DEFAULT 'accounting_profit',
  payment_terms_days INTEGER NOT NULL DEFAULT 7,
  invoice_prefix TEXT NOT NULL DEFAULT 'INV',
  next_invoice_number INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookkeeping_accounts (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense')),
  tax_code TEXT NOT NULL DEFAULT 'no_gst',
  is_control INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(book_id, code),
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id)
);

CREATE TABLE IF NOT EXISTS bookkeeping_transactions (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  job_id INTEGER,
  kind TEXT NOT NULL CHECK (kind IN (
    'sales_invoice','supplier_bill','expense','payment_received','payment_made',
    'tax_payment','payroll_liability','shareholder_transaction','fixed_asset',
    'opening_balance','adjustment'
  )),
  transaction_date TEXT NOT NULL,
  due_date TEXT,
  reference_number TEXT,
  contact_name TEXT,
  contact_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  account_id TEXT,
  status TEXT NOT NULL DEFAULT 'unpaid',
  payment_method TEXT,
  payment_reference TEXT,
  reconciliation_status TEXT NOT NULL DEFAULT 'unreconciled',
  gst_treatment TEXT NOT NULL DEFAULT 'no_gst',
  ex_gst_amount REAL NOT NULL DEFAULT 0,
  gst_amount REAL NOT NULL DEFAULT 0,
  total_incl_gst REAL NOT NULL DEFAULT 0,
  historical INTEGER NOT NULL DEFAULT 0,
  source_type TEXT,
  source_id TEXT,
  supporting_file_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (account_id) REFERENCES bookkeeping_accounts(id),
  UNIQUE(book_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_bk_transactions_book_date
  ON bookkeeping_transactions(book_id, transaction_date, kind);
CREATE INDEX IF NOT EXISTS idx_bk_transactions_job
  ON bookkeeping_transactions(book_id, job_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_bk_transactions_contact_due
  ON bookkeeping_transactions(book_id, contact_name, due_date);

CREATE TABLE IF NOT EXISTS bookkeeping_journals (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  transaction_id TEXT,
  journal_date TEXT NOT NULL,
  reference_number TEXT,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  posted INTEGER NOT NULL DEFAULT 0,
  reversed_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (transaction_id) REFERENCES bookkeeping_transactions(id),
  FOREIGN KEY (reversed_by) REFERENCES bookkeeping_journals(id)
);

CREATE INDEX IF NOT EXISTS idx_bk_journals_book_date
  ON bookkeeping_journals(book_id, journal_date, posted);

CREATE TABLE IF NOT EXISTS bookkeeping_journal_lines (
  id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  ex_gst_amount REAL NOT NULL DEFAULT 0,
  gst_amount REAL NOT NULL DEFAULT 0,
  total_incl_gst REAL NOT NULL DEFAULT 0,
  gst_treatment TEXT NOT NULL DEFAULT 'no_gst',
  contact_name TEXT,
  job_id INTEGER,
  FOREIGN KEY (journal_id) REFERENCES bookkeeping_journals(id),
  FOREIGN KEY (account_id) REFERENCES bookkeeping_accounts(id),
  CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
);

CREATE INDEX IF NOT EXISTS idx_bk_journal_lines_account
  ON bookkeeping_journal_lines(account_id, journal_id);

CREATE TABLE IF NOT EXISTS bookkeeping_payment_allocations (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  payment_transaction_id TEXT NOT NULL,
  invoice_transaction_id TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  allocated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (payment_transaction_id) REFERENCES bookkeeping_transactions(id),
  FOREIGN KEY (invoice_transaction_id) REFERENCES bookkeeping_transactions(id)
);

CREATE TABLE IF NOT EXISTS bookkeeping_tax_events (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('gst','company_income_tax','paye','other_payroll')),
  event_type TEXT NOT NULL CHECK (event_type IN ('liability','payment','adjustment','reserve_transfer')),
  transaction_id TEXT,
  event_date TEXT NOT NULL,
  due_date TEXT,
  reference_number TEXT,
  description TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (transaction_id) REFERENCES bookkeeping_transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_bk_tax_events_book_type_date
  ON bookkeeping_tax_events(book_id, tax_type, event_date);

CREATE TABLE IF NOT EXISTS bookkeeping_tax_accounts (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('gst','company_income_tax','paye','other_payroll')),
  bank_account_name TEXT NOT NULL,
  current_balance REAL NOT NULL DEFAULT 0,
  as_at_date TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id)
);

CREATE TABLE IF NOT EXISTS bookkeeping_tax_adjustments (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('gst','company_income_tax','paye','other_payroll')),
  effective_date TEXT NOT NULL,
  amount REAL NOT NULL,
  reason TEXT NOT NULL,
  accountant_adjusted INTEGER NOT NULL DEFAULT 0,
  reference_number TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id)
);

CREATE TABLE IF NOT EXISTS bookkeeping_export_mappings (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  export_type TEXT NOT NULL,
  mapping_name TEXT NOT NULL,
  field_mapping_json TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  UNIQUE(book_id, export_type, mapping_name)
);

CREATE TABLE IF NOT EXISTS bookkeeping_audit_events (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  transaction_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT,
  event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  before_json TEXT,
  after_json TEXT,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (transaction_id) REFERENCES bookkeeping_transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_bk_audit_entity
  ON bookkeeping_audit_events(book_id, entity_type, entity_id, event_at);

CREATE TABLE IF NOT EXISTS bookkeeping_document_links (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'supporting_document',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (transaction_id) REFERENCES bookkeeping_transactions(id),
  UNIQUE(transaction_id, file_id, role)
);

CREATE TABLE IF NOT EXISTS bookkeeping_fixed_assets (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  transaction_id TEXT,
  asset_name TEXT NOT NULL,
  asset_category TEXT NOT NULL,
  acquired_date TEXT NOT NULL,
  cost_ex_gst REAL NOT NULL DEFAULT 0,
  gst_amount REAL NOT NULL DEFAULT 0,
  gst_treatment TEXT NOT NULL DEFAULT 'no_gst',
  useful_life_months INTEGER,
  depreciation_method TEXT,
  residual_value REAL NOT NULL DEFAULT 0,
  disposed_date TEXT,
  disposal_amount REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (transaction_id) REFERENCES bookkeeping_transactions(id)
);

CREATE TABLE IF NOT EXISTS bookkeeping_opening_balances (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  as_at_date TEXT NOT NULL,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  source_label TEXT NOT NULL DEFAULT 'Accountant supplied opening balance',
  reference_number TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (account_id) REFERENCES bookkeeping_accounts(id),
  CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
);
