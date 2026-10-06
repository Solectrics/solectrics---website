-- Read-only SQLite database integrity and foreign-key data checks.
WITH problems(issue) AS (
 SELECT 'INTEGRITY_CHECK_FAILED:'||integrity_check FROM pragma_integrity_check WHERE integrity_check<>'ok'
 UNION ALL
 SELECT 'FOREIGN_KEY_VIOLATION:'||"table"||':'||coalesce(cast("rowid" AS TEXT),'NULL')||':'||"parent"
 FROM pragma_foreign_key_check
)
SELECT 'JOBHUB_VERIFY_OK:integrity' AS result WHERE NOT EXISTS(SELECT 1 FROM problems)
UNION ALL SELECT issue FROM problems ORDER BY 1;

