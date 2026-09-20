ALTER TABLE suppliers ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;

UPDATE suppliers SET is_default = 1
WHERE name = 'J.A. Russell' COLLATE NOCASE;
