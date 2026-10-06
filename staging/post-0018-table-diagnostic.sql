-- Read-only inventory for investigating a table-count mismatch.
-- Lists schema object names only; no application rows are queried.
WITH expected_tables(name) AS (VALUES
('assessments'),
('bookkeeping_accounts'),
('bookkeeping_audit_events'),
('bookkeeping_bank_accounts'),
('bookkeeping_bank_feed_audit'),
('bookkeeping_bank_feed_imports'),
('bookkeeping_bank_feed_transactions'),
('bookkeeping_books'),
('bookkeeping_document_links'),
('bookkeeping_export_mappings'),
('bookkeeping_fixed_assets'),
('bookkeeping_job_books'),
('bookkeeping_journal_lines'),
('bookkeeping_journals'),
('bookkeeping_opening_balances'),
('bookkeeping_payment_allocations'),
('bookkeeping_reconciliation_matches'),
('bookkeeping_reconciliation_reviews'),
('bookkeeping_supplier_inbox_addresses'),
('bookkeeping_supplier_invoice_events'),
('bookkeeping_supplier_invoice_inbox'),
('bookkeeping_tax_accounts'),
('bookkeeping_tax_adjustments'),
('bookkeeping_tax_events'),
('bookkeeping_transactions'),
('catalogue_imports'),
('costing_lines'),
('costing_options'),
('customer_invoice_versions'),
('customer_quote_versions'),
('email_logs'),
('enquiries'),
('general_job_details'),
('job_files'),
('job_materials'),
('job_supplier_pricing'),
('job_work_logs'),
('jobs'),
('site_visits'),
('supplier_products'),
('suppliers'),
('system_designs')
)
SELECT s.name AS table_name,
 CASE
  WHEN s.name='d1_migrations' THEN 'WRANGLER_D1_MIGRATION_HISTORY'
  WHEN s.name LIKE 'sqlite_%' THEN 'SQLITE_INTERNAL'
  WHEN substr(s.name,1,4)='_cf_' THEN 'CLOUDFLARE_INTERNAL'
  WHEN EXISTS(SELECT 1 FROM expected_tables e WHERE e.name=s.name) THEN 'EXPECTED_JOBHUB_TABLE'
  ELSE 'UNEXPECTED_TABLE_REQUIRES_REVIEW'
 END AS classification
FROM sqlite_schema AS s
WHERE s.type='table' AND s.sql IS NOT NULL
ORDER BY classification, table_name;
