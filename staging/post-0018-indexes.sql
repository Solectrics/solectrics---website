-- Read-only explicit index metadata and indexed-column check.
WITH
expected_indexes(name,table_name,unique_flag,partial_flag) AS (VALUES
('idx_bk_audit_entity','bookkeeping_audit_events',0,0),
('idx_bk_bank_feed_queue','bookkeeping_bank_feed_transactions',0,0),
('idx_bk_bank_feed_reference','bookkeeping_bank_feed_transactions',0,0),
('idx_bk_journal_lines_account','bookkeeping_journal_lines',0,0),
('idx_bk_journals_book_date','bookkeeping_journals',0,0),
('idx_bk_reconciliation_matches_target','bookkeeping_reconciliation_matches',0,0),
('idx_bk_reconciliation_queue','bookkeeping_reconciliation_reviews',0,0),
('idx_bk_tax_events_book_type_date','bookkeeping_tax_events',0,0),
('idx_bk_transactions_book_date','bookkeeping_transactions',0,0),
('idx_bk_transactions_contact_due','bookkeeping_transactions',0,0),
('idx_bk_transactions_job','bookkeeping_transactions',0,0),
('idx_catalogue_imports_supplier','catalogue_imports',0,0),
('idx_costing_lines_job_option','costing_lines',0,0),
('idx_costing_options_job','costing_options',0,0),
('idx_customer_invoices_job_version','customer_invoice_versions',0,0),
('idx_customer_quotes_job_version','customer_quote_versions',0,0),
('idx_enquiries_created_at','enquiries',0,0),
('idx_enquiries_email','enquiries',0,0),
('idx_job_materials_job','job_materials',0,0),
('idx_job_materials_supplier_inbox','job_materials',1,1),
('idx_jobs_supplier_reference_unique','jobs',1,1),
('idx_supplier_invoice_inbox_book_status','bookkeeping_supplier_invoice_inbox',0,0),
('idx_supplier_invoice_inbox_hash','bookkeeping_supplier_invoice_inbox',0,0),
('idx_supplier_invoice_inbox_job','bookkeeping_supplier_invoice_inbox',0,0),
('idx_supplier_invoice_inbox_number','bookkeeping_supplier_invoice_inbox',0,0),
('idx_supplier_products_description','supplier_products',0,0),
('idx_supplier_products_sku','supplier_products',0,0)
),
expected_index_columns(index_name,seqno,column_name) AS (VALUES
('idx_bk_audit_entity',0,'book_id'),
('idx_bk_audit_entity',1,'entity_type'),
('idx_bk_audit_entity',2,'entity_id'),
('idx_bk_audit_entity',3,'event_at'),
('idx_bk_bank_feed_queue',0,'book_id'),
('idx_bk_bank_feed_queue',1,'transaction_status'),
('idx_bk_bank_feed_queue',2,'transaction_date'),
('idx_bk_bank_feed_reference',0,'book_id'),
('idx_bk_bank_feed_reference',1,'reference'),
('idx_bk_bank_feed_reference',2,'amount'),
('idx_bk_journal_lines_account',0,'account_id'),
('idx_bk_journal_lines_account',1,'journal_id'),
('idx_bk_journals_book_date',0,'book_id'),
('idx_bk_journals_book_date',1,'journal_date'),
('idx_bk_journals_book_date',2,'posted'),
('idx_bk_reconciliation_matches_target',0,'book_id'),
('idx_bk_reconciliation_matches_target',1,'target_transaction_id'),
('idx_bk_reconciliation_queue',0,'book_id'),
('idx_bk_reconciliation_queue',1,'review_status'),
('idx_bk_reconciliation_queue',2,'created_at'),
('idx_bk_tax_events_book_type_date',0,'book_id'),
('idx_bk_tax_events_book_type_date',1,'tax_type'),
('idx_bk_tax_events_book_type_date',2,'event_date'),
('idx_bk_transactions_book_date',0,'book_id'),
('idx_bk_transactions_book_date',1,'transaction_date'),
('idx_bk_transactions_book_date',2,'kind'),
('idx_bk_transactions_contact_due',0,'book_id'),
('idx_bk_transactions_contact_due',1,'contact_name'),
('idx_bk_transactions_contact_due',2,'due_date'),
('idx_bk_transactions_job',0,'book_id'),
('idx_bk_transactions_job',1,'job_id'),
('idx_bk_transactions_job',2,'transaction_date'),
('idx_catalogue_imports_supplier',0,'supplier_id'),
('idx_catalogue_imports_supplier',1,'imported_at'),
('idx_costing_lines_job_option',0,'job_id'),
('idx_costing_lines_job_option',1,'option_id'),
('idx_costing_lines_job_option',2,'sort_order'),
('idx_costing_options_job',0,'job_id'),
('idx_costing_options_job',1,'created_at'),
('idx_customer_invoices_job_version',0,'job_id'),
('idx_customer_invoices_job_version',1,'version_number'),
('idx_customer_quotes_job_version',0,'job_id'),
('idx_customer_quotes_job_version',1,'version_number'),
('idx_enquiries_created_at',0,'created_at'),
('idx_enquiries_email',0,'email'),
('idx_job_materials_job',0,'job_id'),
('idx_job_materials_job',1,'created_at'),
('idx_job_materials_supplier_inbox',0,'supplier_invoice_inbox_id'),
('idx_jobs_supplier_reference_unique',0,'supplier_reference'),
('idx_supplier_invoice_inbox_book_status',0,'book_id'),
('idx_supplier_invoice_inbox_book_status',1,'matching_status'),
('idx_supplier_invoice_inbox_book_status',2,'received_at'),
('idx_supplier_invoice_inbox_hash',0,'book_id'),
('idx_supplier_invoice_inbox_hash',1,'content_sha256'),
('idx_supplier_invoice_inbox_job',0,'book_id'),
('idx_supplier_invoice_inbox_job',1,'job_id'),
('idx_supplier_invoice_inbox_job',2,'supplier_invoice_date'),
('idx_supplier_invoice_inbox_number',0,'book_id'),
('idx_supplier_invoice_inbox_number',1,'supplier_name'),
('idx_supplier_invoice_inbox_number',2,'supplier_invoice_number'),
('idx_supplier_products_description',0,'description'),
('idx_supplier_products_sku',0,'supplier_sku')
),
actual_indexes(name,table_name,unique_flag,partial_flag) AS (
 SELECT s.name,s.tbl_name,
  (SELECT il."unique" FROM pragma_index_list(s.tbl_name) AS il WHERE il.name=s.name),
  (SELECT il.partial FROM pragma_index_list(s.tbl_name) AS il WHERE il.name=s.name)
 FROM sqlite_schema AS s WHERE s.type='index' AND s.sql IS NOT NULL
  AND s.name NOT LIKE 'sqlite_%' AND substr(s.name,1,4)<>'_cf_'
),
actual_index_columns(index_name,seqno,column_name) AS (
 SELECT s.name,ii.seqno,ii.name FROM sqlite_schema AS s
 JOIN pragma_index_info(s.name) AS ii
 WHERE s.type='index' AND s.sql IS NOT NULL
  AND s.name NOT LIKE 'sqlite_%' AND substr(s.name,1,4)<>'_cf_'
),
problems(issue) AS (
 SELECT 'INDEX_COUNT expected=27 actual='||(SELECT count(*) FROM actual_indexes)
 WHERE (SELECT count(*) FROM actual_indexes)<>27
 UNION ALL SELECT 'MISSING_OR_MISMATCHED_INDEX:'||e.name FROM expected_indexes e
 WHERE NOT EXISTS(SELECT 1 FROM actual_indexes a WHERE a.name=e.name AND a.table_name=e.table_name
  AND a.unique_flag=e.unique_flag AND a.partial_flag=e.partial_flag)
 UNION ALL SELECT 'UNEXPECTED_INDEX:'||a.name FROM actual_indexes a
 WHERE NOT EXISTS(SELECT 1 FROM expected_indexes e WHERE e.name=a.name AND e.table_name=a.table_name)
 UNION ALL SELECT 'MISSING_INDEX_COLUMN:'||e.index_name||'['||e.seqno||']' FROM expected_index_columns e
 WHERE NOT EXISTS(SELECT 1 FROM actual_index_columns a WHERE a.index_name=e.index_name
  AND a.seqno=e.seqno AND a.column_name IS e.column_name)
 UNION ALL SELECT 'UNEXPECTED_INDEX_COLUMN:'||a.index_name||'['||a.seqno||']' FROM actual_index_columns a
 WHERE NOT EXISTS(SELECT 1 FROM expected_index_columns e WHERE e.index_name=a.index_name
  AND e.seqno=a.seqno AND e.column_name IS a.column_name)
)
SELECT 'JOBHUB_VERIFY_OK:indexes' AS result WHERE NOT EXISTS(SELECT 1 FROM problems)
UNION ALL SELECT issue FROM problems ORDER BY 1;

