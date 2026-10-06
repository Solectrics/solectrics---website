-- Read-only D1-supported consistency checks, returned as two result batches.
-- Full SQLite integrity_check is not authorized by D1. quick_check checks
-- database structure and records, but not index contents or UNIQUE constraints.
PRAGMA quick_check;
PRAGMA foreign_key_check;
