const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS job_supplier_pricing (
    job_id INTEGER PRIMARY KEY,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

const FIELD_LIMIT = 2000;
function errorResponse(message, status = 500, detail) {
  return Response.json({ ok: false, error: message, ...(detail ? { detail } : {}) }, { status });
}
function cleanPricing(data) {
  const source = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const clean = {};
  for (const [key, value] of Object.entries(source)) {
    if (!/^[a-z_]+$/.test(key)) continue;
    clean[key] = typeof value === "boolean" ? value : String(value ?? "").slice(0, FIELD_LIMIT);
  }
  return clean;
}
export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    const jobId = Number(new URL(context.request.url).searchParams.get("job_id"));
    if (!db) return errorResponse("D1 database binding DB is not available");
    if (!Number.isInteger(jobId) || jobId <= 0) return errorResponse("job_id is required", 400);
    await db.prepare(CREATE_TABLE).run();
    const row = await db.prepare("SELECT data_json, updated_at FROM job_supplier_pricing WHERE job_id = ?").bind(jobId).first();
    return Response.json({ ok: true, pricing: row ? { ...JSON.parse(row.data_json), updated_at: row.updated_at } : null });
  } catch (error) {
    console.error("Supplier pricing GET error:", error);
    return errorResponse("Unable to load supplier pricing", 500, error.message);
  }
}
export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    const body = await context.request.json();
    const jobId = Number(body.job_id);
    if (!db) return errorResponse("D1 database binding DB is not available");
    if (!Number.isInteger(jobId) || jobId <= 0) return errorResponse("job_id is required", 400);
    await db.prepare(CREATE_TABLE).run();
    const data = JSON.stringify(cleanPricing(body.pricing));
    await db.prepare(`
      INSERT INTO job_supplier_pricing (job_id, data_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(job_id) DO UPDATE SET data_json = excluded.data_json, updated_at = CURRENT_TIMESTAMP
    `).bind(jobId, data).run();
    return Response.json({ ok: true, message: "Supplier pricing saved" });
  } catch (error) {
    console.error("Supplier pricing POST error:", error);
    return errorResponse("Unable to save supplier pricing", 500, error.message);
  }
}
