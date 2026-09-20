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
