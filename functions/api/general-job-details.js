const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS general_job_details (
    job_id INTEGER PRIMARY KEY,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

function errorResponse(message, status = 500, detail) {
  return Response.json(
    { ok: false, error: message, ...(detail ? { detail } : {}) },
    { status }
  );
}

function cleanText(value, maxLength = 3000) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanDetails(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const allowed = [
    "job_description", "site_contact", "access_notes", "supply_details",
    "switchboard_details", "existing_installation", "hazards", "work_scope",
    "testing_required", "certification_status", "customer_notes"
  ];
  return Object.fromEntries(allowed.map(key => [key, cleanText(source[key])]));
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    const jobId = Number(new URL(context.request.url).searchParams.get("job_id"));
    if (!db) return errorResponse("D1 database binding DB is not available");
    if (!Number.isInteger(jobId) || jobId <= 0) return errorResponse("job_id is required", 400);

    await db.prepare(CREATE_TABLE).run();
    const row = await db.prepare(
      "SELECT data_json, updated_at FROM general_job_details WHERE job_id = ?"
    ).bind(jobId).first();

    return Response.json({
      ok: true,
      details: row ? { ...JSON.parse(row.data_json), updated_at: row.updated_at } : null
    });
  } catch (error) {
    console.error("General job details GET error:", error);
    return errorResponse("Unable to load electrical job details", 500, error.message);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) return errorResponse("D1 database binding DB is not available");
    const body = await context.request.json();
    const jobId = Number(body.job_id);
    if (!Number.isInteger(jobId) || jobId <= 0) return errorResponse("job_id is required", 400);

    const details = cleanDetails(body.details);
    await db.prepare(CREATE_TABLE).run();
    await db.prepare(`
      INSERT INTO general_job_details (job_id, data_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(job_id) DO UPDATE SET
        data_json = excluded.data_json,
        updated_at = CURRENT_TIMESTAMP
    `).bind(jobId, JSON.stringify(details)).run();

    return Response.json({ ok: true, message: "Electrical job details saved" });
  } catch (error) {
    console.error("General job details POST error:", error);
    return errorResponse("Unable to save electrical job details", 500, error.message);
  }
}
