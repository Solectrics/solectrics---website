-- Give each job a compact supplier/order reference and separate actual costs
-- from materials explicitly approved as customer-billable.
CREATE TABLE IF NOT EXISTS job_materials (
  id TEXT PRIMARY KEY, job_id INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'supplier_invoice',
  supplier_name TEXT, invoice_number TEXT, invoice_date TEXT, invoice_file_id TEXT,
  description TEXT NOT NULL, supplier_sku TEXT, quantity REAL NOT NULL DEFAULT 1,
  unit_code TEXT, unit_cost_ex_gst REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE jobs ADD COLUMN supplier_reference TEXT;
UPDATE jobs SET supplier_reference = 'S' || printf('%04d', id) WHERE supplier_reference IS NULL OR supplier_reference = '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_supplier_reference_unique
  ON jobs(supplier_reference) WHERE supplier_reference IS NOT NULL;

ALTER TABLE job_materials ADD COLUMN billable_to_customer INTEGER NOT NULL DEFAULT 1;
ALTER TABLE job_materials ADD COLUMN customer_markup_percent REAL NOT NULL DEFAULT 30;
ALTER TABLE job_materials ADD COLUMN material_status TEXT NOT NULL DEFAULT 'normal'
  CHECK (material_status IN ('normal','credit','return','stock','warranty','non_billable'));
ALTER TABLE job_materials ADD COLUMN supplier_invoice_inbox_id TEXT;
UPDATE job_materials SET billable_to_customer = 0, material_status = 'stock' WHERE source = 'stock';
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_materials_supplier_inbox
  ON job_materials(supplier_invoice_inbox_id) WHERE supplier_invoice_inbox_id IS NOT NULL;
