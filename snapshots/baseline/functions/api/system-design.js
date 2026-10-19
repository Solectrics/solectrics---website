const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS system_designs (
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
    const url = new URL(context.request.url);
    const jobId = Number(url.searchParams.get("job_id"));

    if (!db) {
      return errorResponse("D1 database binding DB is not available");
    }

    if (!Number.isInteger(jobId) || jobId <= 0) {
      return errorResponse("job_id is required", 400);
    }

    await db.prepare(CREATE_TABLE).run();

    const row = await db
      .prepare(
        "SELECT data_json, updated_at FROM system_designs WHERE job_id = ?"
      )
      .bind(jobId)
      .first();

    return Response.json({
      ok: true,
      system_design: row
        ? { ...JSON.parse(row.data_json), updated_at: row.updated_at }
        : null
    });
  } catch (error) {
    console.error("System design GET error:", error);
    return errorResponse("Unable to load system design", 500, error.message);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    const data = await context.request.json();
    const jobId = Number(data.job_id);

    if (!db) {
      return errorResponse("D1 database binding DB is not available");
    }

    if (!Number.isInteger(jobId) || jobId <= 0) {
      return errorResponse("job_id is required", 400);
    }

    const systemDesign = data.system_design;
    if (!systemDesign || typeof systemDesign !== "object" || Array.isArray(systemDesign)) {
      return errorResponse("system_design is required", 400);
    }

    await db.prepare(CREATE_TABLE).run();
    await db
      .prepare(`
        INSERT INTO system_designs (job_id, data_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(job_id) DO UPDATE SET
          data_json = excluded.data_json,
          updated_at = CURRENT_TIMESTAMP
      `)
      .bind(jobId, JSON.stringify(systemDesign))
      .run();

    return Response.json({ ok: true, message: "System design saved" });
  } catch (error) {
    console.error("System design POST error:", error);
    return errorResponse("Unable to save system design", 500, error.message);
  }
}
