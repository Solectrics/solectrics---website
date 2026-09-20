export async function ensureJobTypeColumn(db) {
  const columns = await db.prepare("PRAGMA table_info(jobs)").all();
  if (!(columns.results || []).some(column => column.name === "job_type")) {
    try {
      await db.prepare(
        "ALTER TABLE jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'solar'"
      ).run();
    } catch (error) {
      if (!String(error.message || error).toLowerCase().includes("duplicate column")) {
        throw error;
      }
    }
  }
}

export async function ensureJobFileRoleColumn(db) {
  const columns = await db.prepare("PRAGMA table_info(job_files)").all();
  if (!(columns.results || []).some(column => column.name === "document_role")) {
    try {
      await db.prepare("ALTER TABLE job_files ADD COLUMN document_role TEXT").run();
    } catch (error) {
      if (!String(error.message || error).toLowerCase().includes("duplicate column")) {
        throw error;
      }
    }
  }
}

export async function ensureSupplierCatalogueSchema(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS supplier_products (
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
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS catalogue_imports (
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
      )
    `),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_supplier_products_description ON supplier_products(description)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_supplier_products_sku ON supplier_products(supplier_sku)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_catalogue_imports_supplier ON catalogue_imports(supplier_id, imported_at)")
  ]);
}

export async function ensureInternalCostingSchema(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS costing_options (
        id TEXT PRIMARY KEY,
        job_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        default_markup_percent REAL NOT NULL DEFAULT 30,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    db.prepare(`
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
      )
    `),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_costing_options_job ON costing_options(job_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_costing_lines_job_option ON costing_lines(job_id, option_id, sort_order)")
  ]);
}
