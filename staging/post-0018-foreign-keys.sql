-- Read-only exact foreign-key-definition check.
WITH
expected_foreign_keys(source_table,source_column,target_table,target_column,on_update,on_delete) AS (VALUES
('bookkeeping_accounts','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_audit_events','transaction_id','bookkeeping_transactions','id','NO ACTION','NO ACTION'),
('bookkeeping_audit_events','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_bank_accounts','ledger_account_id','bookkeeping_accounts','id','NO ACTION','NO ACTION'),
('bookkeeping_bank_accounts','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_bank_feed_audit','bank_transaction_id','bookkeeping_bank_feed_transactions','id','NO ACTION','NO ACTION'),
('bookkeeping_bank_feed_audit','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_bank_feed_imports','bank_account_id','bookkeeping_bank_accounts','id','NO ACTION','NO ACTION'),
('bookkeeping_bank_feed_imports','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_bank_feed_transactions','import_id','bookkeeping_bank_feed_imports','id','NO ACTION','NO ACTION'),
('bookkeeping_bank_feed_transactions','bank_account_id','bookkeeping_bank_accounts','id','NO ACTION','NO ACTION'),
('bookkeeping_bank_feed_transactions','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_document_links','transaction_id','bookkeeping_transactions','id','NO ACTION','NO ACTION'),
('bookkeeping_document_links','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_export_mappings','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_fixed_assets','transaction_id','bookkeeping_transactions','id','NO ACTION','NO ACTION'),
('bookkeeping_fixed_assets','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_job_books','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_journal_lines','account_id','bookkeeping_accounts','id','NO ACTION','NO ACTION'),
('bookkeeping_journal_lines','journal_id','bookkeeping_journals','id','NO ACTION','NO ACTION'),
('bookkeeping_journals','reversed_by','bookkeeping_journals','id','NO ACTION','NO ACTION'),
('bookkeeping_journals','transaction_id','bookkeeping_transactions','id','NO ACTION','NO ACTION'),
('bookkeeping_journals','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_opening_balances','account_id','bookkeeping_accounts','id','NO ACTION','NO ACTION'),
('bookkeeping_opening_balances','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_payment_allocations','invoice_transaction_id','bookkeeping_transactions','id','NO ACTION','NO ACTION'),
('bookkeeping_payment_allocations','payment_transaction_id','bookkeeping_transactions','id','NO ACTION','NO ACTION'),
('bookkeeping_payment_allocations','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_reconciliation_matches','target_transaction_id','bookkeeping_transactions','id','NO ACTION','NO ACTION'),
('bookkeeping_reconciliation_matches','payment_transaction_id','bookkeeping_transactions','id','NO ACTION','NO ACTION'),
('bookkeeping_reconciliation_matches','bank_transaction_id','bookkeeping_bank_feed_transactions','id','NO ACTION','NO ACTION'),
('bookkeeping_reconciliation_matches','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_reconciliation_reviews','selected_transaction_id','bookkeeping_transactions','id','NO ACTION','NO ACTION'),
('bookkeeping_reconciliation_reviews','bank_transaction_id','bookkeeping_bank_feed_transactions','id','NO ACTION','NO ACTION'),
('bookkeeping_reconciliation_reviews','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_supplier_inbox_addresses','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_supplier_invoice_events','inbox_id','bookkeeping_supplier_invoice_inbox','id','NO ACTION','NO ACTION'),
('bookkeeping_supplier_invoice_events','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_supplier_invoice_inbox','accounting_transaction_id','bookkeeping_transactions','id','NO ACTION','NO ACTION'),
('bookkeeping_supplier_invoice_inbox','duplicate_of_id','bookkeeping_supplier_invoice_inbox','id','NO ACTION','NO ACTION'),
('bookkeeping_supplier_invoice_inbox','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_tax_accounts','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_tax_adjustments','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_tax_events','transaction_id','bookkeeping_transactions','id','NO ACTION','NO ACTION'),
('bookkeeping_tax_events','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('bookkeeping_transactions','account_id','bookkeeping_accounts','id','NO ACTION','NO ACTION'),
('bookkeeping_transactions','book_id','bookkeeping_books','id','NO ACTION','NO ACTION'),
('catalogue_imports','supplier_id','suppliers','id','NO ACTION','NO ACTION'),
('costing_lines','supplier_product_id','supplier_products','id','NO ACTION','NO ACTION'),
('costing_lines','option_id','costing_options','id','NO ACTION','NO ACTION'),
('jobs','enquiry_id','enquiries','id','NO ACTION','NO ACTION'),
('supplier_products','supplier_id','suppliers','id','NO ACTION','NO ACTION')
),
actual_foreign_keys(source_table,source_column,target_table,target_column,on_update,on_delete) AS (
 SELECT s.name,fk."from",fk."table",fk."to",upper(fk.on_update),upper(fk.on_delete)
 FROM sqlite_schema AS s JOIN pragma_foreign_key_list(s.name) AS fk
 WHERE s.type='table' AND s.sql IS NOT NULL
  AND s.name NOT LIKE 'sqlite_%' AND substr(s.name,1,4)<>'_cf_' AND s.name<>'d1_migrations'
),
problems(issue) AS (
 SELECT 'MISSING_FOREIGN_KEY:'||e.source_table||'.'||e.source_column||'->'||e.target_table||'.'||e.target_column
 FROM expected_foreign_keys e WHERE NOT EXISTS(
  SELECT 1 FROM actual_foreign_keys a WHERE a.source_table=e.source_table
   AND a.source_column=e.source_column AND a.target_table=e.target_table
   AND a.target_column=e.target_column AND a.on_update=e.on_update AND a.on_delete=e.on_delete
 )
 UNION ALL
 SELECT 'UNEXPECTED_FOREIGN_KEY:'||a.source_table||'.'||a.source_column||'->'||a.target_table||'.'||a.target_column
 FROM actual_foreign_keys a WHERE NOT EXISTS(
  SELECT 1 FROM expected_foreign_keys e WHERE e.source_table=a.source_table
   AND e.source_column=a.source_column AND e.target_table=a.target_table
   AND e.target_column=a.target_column AND e.on_update=a.on_update AND e.on_delete=a.on_delete
 )
)
SELECT 'JOBHUB_VERIFY_OK:foreign-keys' AS result WHERE NOT EXISTS(SELECT 1 FROM problems)
UNION ALL SELECT issue FROM problems ORDER BY 1;

