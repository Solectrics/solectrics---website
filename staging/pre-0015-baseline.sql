-- Clean staging baseline for the live Job Hub schema immediately before migration 0015.

-- Source: user-supplied schema-only sqlite_schema CSV; no row/customer/job data is included.

-- Cloudflare _cf_* and SQLite sqlite_* internal objects are omitted.

-- This is a post-0014 baseline. Apply only migrations 0015 and later to this schema.

PRAGMA foreign_keys = ON;



CREATE TABLE assessments (   id INTEGER PRIMARY KEY AUTOINCREMENT,   job_id INTEGER NOT NULL UNIQUE,   solar_kw REAL,   panel_count INTEGER,   inverter TEXT,   estimated_generation_kwh INTEGER,   hot_water_strategy TEXT,   smart_controls TEXT,   battery_option TEXT,   battery_kwh REAL,   tariff_recommendation TEXT,   site_notes TEXT,   recommendation TEXT,   updated_at TEXT DEFAULT CURRENT_TIMESTAMP , panel_wattage INTEGER DEFAULT 445, roof_orientation TEXT, battery_reason TEXT, current_retailer TEXT, import_rate REAL, export_rate REAL, controlled_hot_water TEXT, recommended_tariff TEXT, tariff_notes TEXT);

CREATE TABLE catalogue_imports (
        id TEXT PRIMARY KEY,
        supplier_id TEXT NOT NULL,
        source_filename TEXT,
        mapping_json TEXT,
        row_count INTEGER NOT NULL DEFAULT 0,
        created_count INTEGER NOT NULL DEFAULT 0,
        updated_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
      );

CREATE TABLE costing_lines (
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

CREATE TABLE costing_options (
        id TEXT PRIMARY KEY,
        job_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        default_markup_percent REAL NOT NULL DEFAULT 30,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE customer_invoice_versions (
        id TEXT PRIMARY KEY,
        job_id INTEGER NOT NULL,
        version_number INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        snapshot_json TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        issued_at TEXT,
        paid_at TEXT,
        voided_at TEXT,
        UNIQUE (job_id, version_number)
      );

CREATE TABLE customer_quote_versions (
        id TEXT PRIMARY KEY,
        job_id INTEGER NOT NULL,
        version_number INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        snapshot_json TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        issued_at TEXT,
        accepted_at TEXT,
        UNIQUE (job_id, version_number)
      );

CREATE TABLE email_logs (
    id TEXT PRIMARY KEY,
    job_id INTEGER NOT NULL,
    email_type TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    provider_message_id TEXT,
    status TEXT NOT NULL,
    included_json TEXT,
    missing_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE enquiries (   id INTEGER PRIMARY KEY AUTOINCREMENT,   enquiry_ref TEXT UNIQUE NOT NULL,   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,    customer_name TEXT,   email TEXT,   phone TEXT,   address TEXT,    answers_json TEXT NOT NULL,    summer_bill_file TEXT,   winter_bill_file TEXT,    opensolar_status TEXT NOT NULL DEFAULT 'not_created',   opensolar_project_id TEXT,    job_status TEXT NOT NULL DEFAULT 'enquiry',   notes TEXT );

CREATE TABLE general_job_details (
    job_id INTEGER PRIMARY KEY,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

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

CREATE TABLE job_materials (
    id TEXT PRIMARY KEY,
    job_id INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'supplier_invoice',
    supplier_name TEXT,
    invoice_number TEXT,
    invoice_date TEXT,
    invoice_file_id TEXT,
    description TEXT NOT NULL,
    supplier_sku TEXT,
    quantity REAL NOT NULL DEFAULT 1,
    unit_code TEXT,
    unit_cost_ex_gst REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE job_supplier_pricing (
    job_id INTEGER PRIMARY KEY,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE job_work_logs (
    id TEXT PRIMARY KEY,
    job_id INTEGER NOT NULL,
    work_date TEXT NOT NULL,
    hours REAL NOT NULL,
    supervisor TEXT,
    supervision_type TEXT NOT NULL,
    competency TEXT NOT NULL,
    work_completed TEXT NOT NULL,
    tests_results TEXT,
    issues_notes TEXT,
    supervisor_notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  , start_time TEXT, finish_time TEXT, materials_used TEXT, certification_status TEXT, work_dates TEXT, days REAL NOT NULL DEFAULT 1);

CREATE TABLE jobs (   id INTEGER PRIMARY KEY AUTOINCREMENT,   enquiry_id INTEGER NOT NULL,   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   job_status TEXT NOT NULL DEFAULT 'new_enquiry',   next_action TEXT,   next_action_date TEXT,   assigned_to TEXT,   quote_amount REAL,   quote_status TEXT DEFAULT 'not_started',   accepted_at TEXT, opensolar_project_id TEXT, opensolar_project_url TEXT, opensolar_status TEXT DEFAULT 'not_created', system_size_kw REAL, inverter TEXT, battery TEXT, proposal_value REAL, proposal_sent_at TEXT, icp TEXT, vector_dg_status TEXT DEFAULT 'not_started', vector_dg_submitted_at TEXT, vector_dg_reference TEXT, vector_dg_approved_at TEXT, export_limit_kw REAL, retailer TEXT, retailer_plan TEXT, import_rate_cents REAL, export_rate_cents REAL, daily_fixed_charge REAL, tariff_check_status TEXT DEFAULT 'not_checked', recommended_retailer TEXT, recommended_plan TEXT, retailer_status TEXT DEFAULT 'not_started', retailer_contacted_at TEXT, meter_status TEXT DEFAULT 'not_checked', export_confirmed INTEGER DEFAULT 0, finance_type TEXT DEFAULT 'unknown', finance_provider TEXT, finance_status TEXT DEFAULT 'not_applicable', deposit_required REAL, deposit_status TEXT DEFAULT 'not_requested', deposit_received REAL, deposit_received_at TEXT, materials_status TEXT DEFAULT 'not_ordered', materials_cost REAL, materials_ordered_at TEXT, materials_received_at TEXT, supplier TEXT, install_status TEXT DEFAULT 'not_scheduled', install_date TEXT, install_completed_at TEXT, trainee_hours REAL, trainee_work_notes TEXT, install_photos_status TEXT DEFAULT 'not_uploaded', test_sheet_status TEXT DEFAULT 'not_completed', supervisor TEXT DEFAULT 'Ben', supervision_status TEXT DEFAULT 'not_started', supervisor_approval_status TEXT DEFAULT 'not_approved', inspection_status TEXT DEFAULT 'not_required', inspector TEXT, inspection_date TEXT, coc_status TEXT DEFAULT 'not_issued', coc_number TEXT, coc_issued_at TEXT, final_payment_status TEXT DEFAULT 'not_due', final_payment_received_at TEXT, job_type TEXT NOT NULL DEFAULT 'solar',   FOREIGN KEY (enquiry_id) REFERENCES enquiries(id) );

CREATE TABLE site_visits (
    job_id INTEGER PRIMARY KEY,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE supplier_products (
        id TEXT PRIMARY KEY,
        supplier_id TEXT NOT NULL,
        supplier_sku TEXT NOT NULL COLLATE NOCASE,
        description TEXT NOT NULL,
        unit_code TEXT,
        category_code TEXT,
        barcode TEXT,
        list_price REAL,
        buy_price REAL,
        gst_treatment TEXT NOT NULL DEFAULT 'exclusive',
        brand TEXT,
        manufacturer_sku TEXT,
        price_class TEXT,
        source_price_date TEXT,
        last_imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        active INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        UNIQUE (supplier_id, supplier_sku)
      );

CREATE TABLE suppliers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      , is_default INTEGER NOT NULL DEFAULT 0);

CREATE TABLE system_designs (
    job_id INTEGER PRIMARY KEY,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

CREATE INDEX idx_catalogue_imports_supplier ON catalogue_imports(supplier_id, imported_at);

CREATE INDEX idx_costing_lines_job_option ON costing_lines(job_id, option_id, sort_order);

CREATE INDEX idx_costing_options_job ON costing_options(job_id, created_at);

CREATE INDEX idx_customer_invoices_job_version ON customer_invoice_versions(job_id, version_number DESC);

CREATE INDEX idx_customer_quotes_job_version ON customer_quote_versions(job_id, version_number DESC);

CREATE INDEX idx_enquiries_created_at ON enquiries(created_at);

CREATE INDEX idx_enquiries_email ON enquiries(email);

CREATE INDEX idx_job_materials_job ON job_materials(job_id, created_at);

CREATE INDEX idx_supplier_products_description ON supplier_products(description);

CREATE INDEX idx_supplier_products_sku ON supplier_products(supplier_sku);


