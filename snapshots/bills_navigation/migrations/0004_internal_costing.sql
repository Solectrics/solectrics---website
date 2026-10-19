CREATE TABLE IF NOT EXISTS costing_options (
  id TEXT PRIMARY KEY,
  job_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  default_markup_percent REAL NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS costing_lines (
  id TEXT PRIMARY KEY,
  job_id INTEGER NOT NULL,
  option_id TEXT,
  supplier_product_id TEXT,
  supplier_name TEXT,
  supplier_sku TEXT,
  description TEXT NOT NULL,
  unit_code TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit_cost REAL NOT NULL DEFAULT 0,
  markup_percent REAL NOT NULL DEFAULT 0,
  customer_unit_price REAL NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'materials',
  display_mode TEXT NOT NULL DEFAULT 'show',
  combine_label TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (option_id) REFERENCES costing_options(id),
  FOREIGN KEY (supplier_product_id) REFERENCES supplier_products(id)
);

CREATE INDEX IF NOT EXISTS idx_costing_options_job ON costing_options(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_costing_lines_job_option ON costing_lines(job_id, option_id, sort_order);
