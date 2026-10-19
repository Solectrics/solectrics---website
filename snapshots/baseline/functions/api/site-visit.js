const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS site_visits (
    job_id INTEGER PRIMARY KEY,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

function errorResponse(message, status = 500, detail) {
  return Response.json(
    { error: message, ...(detail ? { detail } : {}) },
    { status }
  );
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    const jobId = Number(new URL(context.request.url).searchParams.get("job_id"));

    if (!db) return errorResponse("D1 database binding DB is not available");
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return errorResponse("job_id is required", 400);
    }

    await db.prepare(CREATE_TABLE).run();
    const row = await db
      .prepare("SELECT data_json, updated_at FROM site_visits WHERE job_id = ?")
      .bind(jobId)
      .first();

    return Response.json({
      ok: true,
      site_visit: row
        ? { ...JSON.parse(row.data_json), updated_at: row.updated_at }
        : null
    });
  } catch (error) {
    console.error("Site visit GET error:", error);
    return errorResponse("Unable to load site visit", 500, error.message);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    const data = await context.request.json();
    const jobId = Number(data.job_id);

    if (!db) return errorResponse("D1 database binding DB is not available");
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return errorResponse("job_id is required", 400);
    }
    if (!data.site_visit || typeof data.site_visit !== "object" || Array.isArray(data.site_visit)) {
      return errorResponse("site_visit is required", 400);
    }

    await db.prepare(CREATE_TABLE).run();
    await db.prepare(`
      INSERT INTO site_visits (job_id, data_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(job_id) DO UPDATE SET
        data_json = excluded.data_json,
        updated_at = CURRENT_TIMESTAMP
    `)
      .bind(jobId, JSON.stringify(data.site_visit))
      .run();

    return Response.json({ ok: true, message: "Site visit saved" });
  } catch (error) {
    console.error("Site visit POST error:", error);
    return errorResponse("Unable to save site visit", 500, error.message);
  }
}
