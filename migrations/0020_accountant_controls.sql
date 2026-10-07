-- Accountant-ready controls for standalone small-business bookkeeping.
-- Additive only: no existing transactions or operational records are rewritten.

CREATE TABLE IF NOT EXISTS bookkeeping_period_locks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  lock_type TEXT NOT NULL CHECK (lock_type IN ('month','gst','year','accountant')),
  locked_through TEXT NOT NULL,
  reason TEXT NOT NULL,
  locked_by TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TEXT,
  released_by TEXT,
  release_reason TEXT,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id)
);

CREATE INDEX IF NOT EXISTS idx_bk_period_locks_active
  ON bookkeeping_period_locks(book_id, active, locked_through);

CREATE TABLE IF NOT EXISTS bookkeeping_credit_notes (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  job_id INTEGER,
  original_transaction_id TEXT NOT NULL,
  source_invoice_id TEXT,
  credit_number TEXT NOT NULL,
  credit_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  ex_gst_amount REAL NOT NULL DEFAULT 0,
  gst_amount REAL NOT NULL DEFAULT 0,
  total_incl_gst REAL NOT NULL DEFAULT 0,
  transaction_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','void')),
  issued_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at TEXT,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (original_transaction_id) REFERENCES bookkeeping_transactions(id),
  FOREIGN KEY (transaction_id) REFERENCES bookkeeping_transactions(id),
  UNIQUE(book_id, credit_number),
  UNIQUE(transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_bk_credit_notes_original
  ON bookkeeping_credit_notes(book_id, original_transaction_id, credit_date);

CREATE TABLE IF NOT EXISTS bookkeeping_accountant_adjustments (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  adjustment_type TEXT NOT NULL DEFAULT 'year_end',
  reason TEXT NOT NULL,
  prepared_by TEXT NOT NULL,
  reviewed_by TEXT,
  review_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (review_status IN ('unreviewed','reviewed','rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  FOREIGN KEY (book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (transaction_id) REFERENCES bookkeeping_transactions(id),
  UNIQUE(transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_bk_accountant_adjustments_review
  ON bookkeeping_accountant_adjustments(book_id, review_status, created_at);
