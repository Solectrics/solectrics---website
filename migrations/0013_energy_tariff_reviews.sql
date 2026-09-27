-- Pre-install energy and tariff assessment. JSON keeps the model modular while
-- tariff fields remain structured for a later EIEP14A importer.
CREATE TABLE IF NOT EXISTS energy_reviews (
  job_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft',
  current_plan_json TEXT NOT NULL DEFAULT '{}',
  baseline_json TEXT NOT NULL DEFAULT '{}',
  proposed_system_json TEXT NOT NULL DEFAULT '{}',
  scenario_json TEXT NOT NULL DEFAULT '{}',
  model_json TEXT NOT NULL DEFAULT '{}',
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  selected_scenario TEXT NOT NULL DEFAULT 'solar_smart',
  customer_summary TEXT,
  tariffs_checked_date TEXT,
  consumption_period_start TEXT,
  consumption_period_end TEXT,
  post_install_review_due TEXT,
  post_install_actuals_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_energy_tariffs (
  id TEXT PRIMARY KEY,
  job_id INTEGER NOT NULL,
  retailer TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  product_code TEXT,
  pricing_type TEXT NOT NULL DEFAULT 'needs_review',
  network_region TEXT,
  daily_charge_cents REAL,
  standard_import_rate_cents REAL,
  peak_import_rate_cents REAL,
  offpeak_import_rate_cents REAL,
  controlled_import_rate_cents REAL,
  ev_night_rate_cents REAL,
  solar_export_rate_cents REAL,
  peak_solar_export_rate_cents REAL,
  peak_import_periods_json TEXT NOT NULL DEFAULT '[]',
  offpeak_import_periods_json TEXT NOT NULL DEFAULT '[]',
  peak_export_periods_json TEXT NOT NULL DEFAULT '[]',
  annual_fees_nzd REAL,
  transition_cost_nzd REAL,
  exit_cost_nzd REAL,
  eligibility_conditions TEXT,
  source_name TEXT,
  source_url TEXT,
  source_format TEXT NOT NULL DEFAULT 'manual',
  source_record_id TEXT,
  effective_date TEXT,
  last_verified_date TEXT,
  notes TEXT,
  is_current_plan INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_energy_tariffs_job
  ON job_energy_tariffs(job_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_energy_tariffs_source
  ON job_energy_tariffs(retailer, product_code, effective_date);
