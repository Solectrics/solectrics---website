-- Additive multi-business ownership, verified identity, membership and module configuration.
-- Existing operational/job records and bookkeeping entries remain unchanged until explicitly linked.

CREATE TABLE IF NOT EXISTS jobhub_users (
  id TEXT PRIMARY KEY,
  primary_email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jobhub_user_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email TEXT COLLATE NOCASE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  last_seen_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES jobhub_users(id),
  UNIQUE(provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_jobhub_identities_user
  ON jobhub_user_identities(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_jobhub_identities_email
  ON jobhub_user_identities(email);

CREATE TABLE IF NOT EXISTS jobhub_businesses (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  legal_name TEXT,
  business_type TEXT NOT NULL DEFAULT 'other'
    CHECK (business_type IN ('company','sole_trader','partnership','trust','charity','other')),
  currency TEXT NOT NULL DEFAULT 'NZD',
  timezone TEXT NOT NULL DEFAULT 'Pacific/Auckland',
  active INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jobhub_business_owners (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ownership_percent REAL,
  ownership_type TEXT NOT NULL DEFAULT 'owner'
    CHECK (ownership_type IN ('owner','beneficial_owner','controller','trustee','partner')),
  is_primary INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT,
  effective_to TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES jobhub_businesses(id),
  FOREIGN KEY (user_id) REFERENCES jobhub_users(id),
  UNIQUE(business_id, user_id, ownership_type),
  CHECK (ownership_percent IS NULL OR (ownership_percent >= 0 AND ownership_percent <= 100))
);

CREATE INDEX IF NOT EXISTS idx_jobhub_business_owners_business
  ON jobhub_business_owners(business_id, effective_to);

CREATE TABLE IF NOT EXISTS jobhub_business_memberships (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('owner','admin','bookkeeper','manager','operator','viewer')),
  permissions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited','active','suspended','revoked')),
  invited_by_user_id TEXT,
  joined_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES jobhub_businesses(id),
  FOREIGN KEY (user_id) REFERENCES jobhub_users(id),
  FOREIGN KEY (invited_by_user_id) REFERENCES jobhub_users(id),
  UNIQUE(business_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_jobhub_memberships_user
  ON jobhub_business_memberships(user_id, status, business_id);

CREATE TABLE IF NOT EXISTS jobhub_business_modules (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  module_code TEXT NOT NULL
    CHECK (module_code IN ('core_accounting','jobs_trades','events','pos','electrical_solar')),
  enabled INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES jobhub_businesses(id),
  UNIQUE(business_id, module_code)
);

CREATE INDEX IF NOT EXISTS idx_jobhub_business_modules_enabled
  ON jobhub_business_modules(business_id, enabled, module_code);

-- A book remains the accounting boundary. The business link is intentionally nullable so
-- all existing books continue to work until a business is explicitly configured.
ALTER TABLE bookkeeping_books ADD COLUMN business_id TEXT;
ALTER TABLE bookkeeping_books ADD COLUMN book_code TEXT;
ALTER TABLE bookkeeping_books ADD COLUMN book_role TEXT NOT NULL DEFAULT 'primary'
  CHECK (book_role IN ('primary','management','historical','other'));

CREATE INDEX IF NOT EXISTS idx_bookkeeping_books_business
  ON bookkeeping_books(business_id, active, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookkeeping_books_business_code
  ON bookkeeping_books(business_id, book_code)
  WHERE business_id IS NOT NULL AND book_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS jobhub_business_book_settings (
  business_id TEXT PRIMARY KEY,
  default_book_id TEXT,
  supplier_inbox_book_id TEXT,
  sales_book_id TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES jobhub_businesses(id),
  FOREIGN KEY (default_book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (supplier_inbox_book_id) REFERENCES bookkeeping_books(id),
  FOREIGN KEY (sales_book_id) REFERENCES bookkeeping_books(id)
);
