export async function ensureJobTypeColumn(db) {
  const columns = await db.prepare("PRAGMA table_info(jobs)").all();
  if (!(columns.results || []).some(column => column.name === "job_type")) {
    try {
      await db.prepare(
        "ALTER TABLE jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'solar'"
      ).run();
    } catch (error) {
      if (!String(error.message || error).toLowerCase().includes("duplicate column")) {
        throw error;
      }
    }
  }
}

export async function ensureJobFileRoleColumn(db) {
  const columns = await db.prepare("PRAGMA table_info(job_files)").all();
  if (!(columns.results || []).some(column => column.name === "document_role")) {
    try {
      await db.prepare("ALTER TABLE job_files ADD COLUMN document_role TEXT").run();
    } catch (error) {
      if (!String(error.message || error).toLowerCase().includes("duplicate column")) {
        throw error;
      }
    }
  }
}
