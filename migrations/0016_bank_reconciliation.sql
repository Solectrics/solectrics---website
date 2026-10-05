-- Provider-neutral bank feed boundary and reconciliation review queue.
-- Feed rows are imported first; only an explicit high-confidence match or user decision posts accounting entries.
ALTER TABLE bookkeeping_transactions
  ADD COLUMN allowable_input_gst REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS bookkeeping_bank_accounts (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  ledger_account_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  provider_code TEXT NOT NULL DEFAULT 'manual_import',
  external_account_id TEXT,
  account_number_masked TEXT,
  currency TEXT NOT NULL DEFAULT 'NZD',
  current_balance REAL,
  balance_as_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (ledger_account_id) REFERENCES bookkeeping_accounts(id),
  UNIQUE(book_id, provider_code, external_account_id)
);

CREATE TABLE IF NOT EXISTS bookkeeping_bank_feed_imports (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  bank_account_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_batch_id TEXT,
  import_fingerprint TEXT NOT NULL,
  source_filename TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  imported_by TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (bank_account_id) REFERENCES bookkeeping_bank_accounts(id),
  UNIQUE(bank_account_id, import_fingerprint)
);

CREATE TABLE IF NOT EXISTS bookkeeping_bank_feed_transactions (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  bank_account_id TEXT NOT NULL,
  import_id TEXT NOT NULL,
  external_transaction_id TEXT,
  transaction_date TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inflow','outflow')),
  amount REAL NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'NZD',
  counterparty TEXT,
  reference TEXT,
  description TEXT NOT NULL DEFAULT '',
  transaction_code TEXT,
  transaction_status TEXT NOT NULL DEFAULT 'needs_matching'
    CHECK (transaction_status IN ('needs_matching','matched','partially_matched','skipped')),
  reconciliation_status TEXT NOT NULL DEFAULT 'unreconciled',
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (bank_account_id) REFERENCES bookkeeping_bank_accounts(id),
  FOREIGN KEY (import_id) REFERENCES bookkeeping_bank_feed_imports(id),
  UNIQUE(bank_account_id, external_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_bk_bank_feed_queue
  ON bookkeeping_bank_feed_transactions(book_id, transaction_status, transaction_date);
CREATE INDEX IF NOT EXISTS idx_bk_bank_feed_reference
  ON bookkeeping_bank_feed_transactions(book_id, reference, amount);

CREATE TABLE IF NOT EXISTS bookkeeping_reconciliation_reviews (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  bank_transaction_id TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'needs_matching'
    CHECK (review_status IN ('needs_matching','auto_matched','approved','rejected','skipped')),
  suggested_matches_json TEXT NOT NULL DEFAULT '[]',
  selected_transaction_id TEXT,
  confidence_score INTEGER,
  decision_reason TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (bank_transaction_id) REFERENCES bookkeeping_bank_feed_transactions(id),
  FOREIGN KEY (selected_transaction_id) REFERENCES bookkeeping_transactions(id),
  UNIQUE(bank_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_bk_reconciliation_queue
  ON bookkeeping_reconciliation_reviews(book_id, review_status, created_at);

CREATE TABLE IF NOT EXISTS bookkeeping_reconciliation_matches (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  bank_transaction_id TEXT NOT NULL,
  payment_transaction_id TEXT NOT NULL,
  target_transaction_id TEXT NOT NULL,
  allocated_amount REAL NOT NULL CHECK (allocated_amount > 0),
  match_method TEXT NOT NULL CHECK (match_method IN ('automatic','user_approved')),
  confidence_score INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (bank_transaction_id) REFERENCES bookkeeping_bank_feed_transactions(id),
  FOREIGN KEY (payment_transaction_id) REFERENCES bookkeeping_transactions(id),
  FOREIGN KEY (target_transaction_id) REFERENCES bookkeeping_transactions(id),
  UNIQUE(bank_transaction_id, target_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_bk_reconciliation_matches_target
  ON bookkeeping_reconciliation_matches(book_id, target_transaction_id);

CREATE TABLE IF NOT EXISTS bookkeeping_bank_feed_audit (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  bank_transaction_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (bank_transaction_id) REFERENCES bookkeeping_bank_feed_transactions(id)
);
