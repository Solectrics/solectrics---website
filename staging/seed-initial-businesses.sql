-- Deployment-specific seed for this Job Hub installation.
-- NOT a numbered schema migration and NOT a white-label product default.
-- Prerequisite: migrations/0019_business_identity_and_modules.sql has been applied.
-- This file intentionally does not create users, identities, memberships or ownership records.
-- Those require verified Cloudflare Access identity subjects from real authenticated sessions.

PRAGMA foreign_keys = ON;

INSERT INTO jobhub_businesses
  (id, slug, name, legal_name, business_type, currency, timezone, settings_json)
VALUES
  ('business-solectrics', 'solectrics', 'Solectrics', 'Solectrics Limited', 'company', 'NZD', 'Pacific/Auckland',
   'undefined'),
  ('business-sol-espresso', 'sol-espresso', 'Sol Espresso', 'Sol Espresso Limited', 'company', 'NZD', 'Pacific/Auckland',
   '{"seed":"initial-businesses-v1","legal_entity_pending_confirmation":false}'),
  ('business-yogacamp', 'yogacamp', 'YOGACAMP', NULL, 'other', 'GBP', 'Europe/London',
   '{"seed":"initial-businesses-v1","legal_entity_pending_confirmation":true}')
ON CONFLICT(id) DO UPDATE SET
  slug = excluded.slug,
  name = excluded.name,
  legal_name = excluded.legal_name,
  business_type = excluded.business_type,
  currency = excluded.currency,
  timezone = excluded.timezone,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO jobhub_business_modules (id, business_id, module_code, enabled) VALUES
  ('mod-solectrics-core', 'business-solectrics', 'core_accounting', 1),
  ('mod-solectrics-jobs', 'business-solectrics', 'jobs_trades', 1),
  ('mod-solectrics-events', 'business-solectrics', 'events', 0),
  ('mod-solectrics-pos', 'business-solectrics', 'pos', 0),
  ('mod-solectrics-electrical', 'business-solectrics', 'electrical_solar', 1),
  ('mod-espresso-core', 'business-sol-espresso', 'core_accounting', 1),
  ('mod-espresso-jobs', 'business-sol-espresso', 'jobs_trades', 0),
  ('mod-espresso-events', 'business-sol-espresso', 'events', 1),
  ('mod-espresso-pos', 'business-sol-espresso', 'pos', 1),
  ('mod-espresso-electrical', 'business-sol-espresso', 'electrical_solar', 0),
  ('mod-yogacamp-core', 'business-yogacamp', 'core_accounting', 1),
  ('mod-yogacamp-jobs', 'business-yogacamp', 'jobs_trades', 0),
  ('mod-yogacamp-events', 'business-yogacamp', 'events', 1),
  ('mod-yogacamp-pos', 'business-yogacamp', 'pos', 1),
  ('mod-yogacamp-electrical', 'business-yogacamp', 'electrical_solar', 0)
ON CONFLICT(business_id, module_code) DO UPDATE SET
  enabled = excluded.enabled,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO jobhub_business_book_settings (business_id)
VALUES ('business-solectrics'), ('business-sol-espresso'), ('business-yogacamp')
ON CONFLICT(business_id) DO NOTHING;

-- Link the existing Solectrics bookkeeping book only when the database has exactly
-- one active, currently-unassigned book. This prevents an accidental cross-business link.
UPDATE bookkeeping_books
SET business_id = 'business-solectrics',
    book_code = COALESCE(book_code, 'SOLECTRICS'),
    book_role = 'primary',
    updated_at = CURRENT_TIMESTAMP
WHERE id = (
  SELECT id FROM bookkeeping_books
  WHERE active = 1 AND business_id IS NULL
  ORDER BY created_at, id
  LIMIT 1
)
AND (SELECT COUNT(*) FROM bookkeeping_books WHERE active = 1 AND business_id IS NULL) = 1;

UPDATE jobhub_business_book_settings
SET default_book_id = (
      SELECT id FROM bookkeeping_books
      WHERE business_id = 'business-solectrics' AND active = 1
      ORDER BY CASE WHEN book_code = 'SOLECTRICS' THEN 0 ELSE 1 END, created_at, id LIMIT 1
    ),
    supplier_inbox_book_id = (
      SELECT id FROM bookkeeping_books
      WHERE business_id = 'business-solectrics' AND active = 1
      ORDER BY CASE WHEN book_code = 'SOLECTRICS' THEN 0 ELSE 1 END, created_at, id LIMIT 1
    ),
    sales_book_id = (
      SELECT id FROM bookkeeping_books
      WHERE business_id = 'business-solectrics' AND active = 1
      ORDER BY CASE WHEN book_code = 'SOLECTRICS' THEN 0 ELSE 1 END, created_at, id LIMIT 1
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE business_id = 'business-solectrics'
  AND (SELECT COUNT(*) FROM bookkeeping_books WHERE business_id = 'business-solectrics' AND active = 1) = 1;
