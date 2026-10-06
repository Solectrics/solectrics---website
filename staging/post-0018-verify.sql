-- Read-only object and per-table column-count check; exact column definitions are checked in three bounded batches.
WITH
expected_tables(name) AS (VALUES
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
),
expected_column_counts(table_name,expected_count) AS (VALUES
('assessments',23),
('bookkeeping_accounts',9),
('bookkeeping_audit_events',10),
('bookkeeping_bank_accounts',14),
('bookkeeping_bank_feed_audit',7),
('bookkeeping_bank_feed_imports',12),
('bookkeeping_bank_feed_transactions',17),
('bookkeeping_books',20),
('bookkeeping_document_links',6),
('bookkeeping_export_mappings',7),
('bookkeeping_fixed_assets',16),
('bookkeeping_job_books',4),
('bookkeeping_journal_lines',12),
('bookkeeping_journals',10),
('bookkeeping_opening_balances',9),
('bookkeeping_payment_allocations',6),
('bookkeeping_reconciliation_matches',10),
('bookkeeping_reconciliation_reviews',12),
('bookkeeping_supplier_inbox_addresses',5),
('bookkeeping_supplier_invoice_events',7),
('bookkeeping_supplier_invoice_inbox',34),
('bookkeeping_tax_accounts',7),
('bookkeeping_tax_adjustments',9),
('bookkeeping_tax_events',12),
('bookkeeping_transactions',27),
('catalogue_imports',9),
('costing_lines',18),
('costing_options',7),
('customer_invoice_versions',10),
('customer_quote_versions',9),
('email_logs',10),
('enquiries',14),
('general_job_details',3),
('job_files',11),
('job_materials',17),
('job_supplier_pricing',3),
('job_work_logs',18),
('jobs',68),
('site_visits',3),
('supplier_products',16),
('suppliers',6),
('system_designs',3)
),
actual_tables(name) AS (
 SELECT name FROM sqlite_schema WHERE type='table' AND sql IS NOT NULL
  AND name NOT LIKE 'sqlite_%' AND substr(name,1,4)<>'_cf_' AND name<>'d1_migrations'
),
actual_column_counts(table_name,actual_count) AS (
 SELECT s.name,count(p.name) FROM sqlite_schema AS s
 JOIN pragma_table_info(s.name) AS p
 WHERE s.type='table' AND s.sql IS NOT NULL
  AND s.name NOT LIKE 'sqlite_%' AND substr(s.name,1,4)<>'_cf_' AND s.name<>'d1_migrations'
 GROUP BY s.name
),
problems(issue) AS (
 SELECT 'TABLE_COUNT expected=42 actual='||(SELECT count(*) FROM actual_tables)
 WHERE (SELECT count(*) FROM actual_tables)<>42
 UNION ALL
 SELECT 'MISSING_TABLE:'||e.name FROM expected_tables e
 WHERE NOT EXISTS(SELECT 1 FROM actual_tables a WHERE a.name=e.name)
 UNION ALL
 SELECT 'UNEXPECTED_TABLE:'||a.name FROM actual_tables a
 WHERE NOT EXISTS(SELECT 1 FROM expected_tables e WHERE e.name=a.name)
 UNION ALL
 SELECT 'COLUMN_COUNT:'||e.table_name||' expected='||e.expected_count||' actual='||coalesce(a.actual_count,0)
 FROM expected_column_counts e LEFT JOIN actual_column_counts a ON a.table_name=e.table_name
 WHERE coalesce(a.actual_count,0)<>e.expected_count
)
SELECT 'JOBHUB_VERIFY_OK:objects' AS result WHERE NOT EXISTS(SELECT 1 FROM problems)
UNION ALL SELECT issue FROM problems ORDER BY 1;

