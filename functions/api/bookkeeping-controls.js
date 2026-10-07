function dateOnly(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export async function activeLockForDate(db, bookId, date) {
  const safe = dateOnly(date);
  if (!safe) throw new Error("A valid YYYY-MM-DD accounting date is required");
  return db.prepare(`SELECT id, lock_type, locked_through, reason, locked_by
    FROM bookkeeping_period_locks
    WHERE book_id = ? AND active = 1 AND locked_through >= ?
    ORDER BY locked_through DESC, created_at DESC LIMIT 1`).bind(bookId, safe).first();
}

export async function assertAccountingDateOpen(db, bookId, date) {
  const lock = await activeLockForDate(db, bookId, date);
  if (!lock) return true;
  const error = new Error(`Accounting period is locked through ${lock.locked_through} (${lock.lock_type}). ${lock.reason}`);
  error.code = "ACCOUNTING_PERIOD_LOCKED";
  error.lock = lock;
  throw error;
}

export function safeAccountingDate(value) {
  return dateOnly(value);
}
