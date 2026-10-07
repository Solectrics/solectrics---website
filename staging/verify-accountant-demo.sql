-- Accountant-demo read-only verification for jobhub-staging.
SELECT id, slug, name, legal_name, business_type, currency, timezone
FROM jobhub_businesses ORDER BY slug;

SELECT business_id, module_code, enabled
FROM jobhub_business_modules ORDER BY business_id, module_code;

SELECT id, name, legal_name, business_id, book_code, book_role, gst_registered, gst_basis, commencement_date
FROM bookkeeping_books WHERE active=1 ORDER BY name;

SELECT business_id, default_book_id, supplier_inbox_book_id, sales_book_id
FROM jobhub_business_book_settings ORDER BY business_id;

SELECT lock_type, locked_through, reason, active, created_at
FROM bookkeeping_period_locks ORDER BY created_at DESC;

SELECT credit_number, credit_date, total_incl_gst, status, original_transaction_id
FROM bookkeeping_credit_notes ORDER BY created_at DESC;

SELECT adjustment_type, reason, prepared_by, reviewed_by, review_status, created_at
FROM bookkeeping_accountant_adjustments ORDER BY created_at DESC;

PRAGMA integrity_check;
PRAGMA foreign_key_check;
