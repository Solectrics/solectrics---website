const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS job_work_logs (
    id TEXT PRIMARY KEY,
    job_id INTEGER NOT NULL,
    work_date TEXT NOT NULL,
    hours REAL NOT NULL,
    supervisor TEXT,
    supervision_type TEXT NOT NULL,
    competency TEXT NOT NULL,
    work_completed TEXT NOT NULL,
    tests_results TEXT,
    issues_notes TEXT,
    supervisor_notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

const SUPERVISION_TYPES = new Set([
  "on_site", "remote", "evidence_review", "other"
]);

const COMPETENCIES = new Set([
  "health_safety", "planning", "cable_installation", "switchboards",
  "testing", "solar_pv", "fault_finding", "documentation", "other"
]);

function errorResponse(message, status = 500, detail) {
  return Response.json(
    { ok: false, error: message, ...(detail ? { detail } : {}) },
    { status }
  );
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
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
    const result = await db.prepare(`
      SELECT id, work_date, hours, supervisor, supervision_type, competency,
             work_completed, tests_results, issues_notes, supervisor_notes, created_at
      FROM job_work_logs
      WHERE job_id = ?
      ORDER BY work_date DESC, created_at DESC
    `).bind(jobId).all();
    const logs = result.results || [];
    const totalHours = logs.reduce((total, log) => total + (Number(log.hours) || 0), 0);

    return Response.json({ ok: true, logs, total_hours: totalHours });
  } catch (error) {
    console.error("Job work logs GET error:", error);
    return errorResponse("Unable to load daily records", 500, error.message);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) return errorResponse("D1 database binding DB is not available");

    const body = await context.request.json();
    const jobId = Number(body.job_id);
    const workDate = cleanText(body.work_date, 10);
    const hours = Number(body.hours);
    const supervisor = cleanText(body.supervisor, 120);
    const supervisionType = SUPERVISION_TYPES.has(body.supervision_type)
      ? body.supervision_type : "other";
    const competency = COMPETENCIES.has(body.competency) ? body.competency : "other";
    const workCompleted = cleanText(body.work_completed, 3000);
    const testsResults = cleanText(body.tests_results, 2000);
    const issuesNotes = cleanText(body.issues_notes, 2000);
    const supervisorNotes = cleanText(body.supervisor_notes, 2000);

    if (!Number.isInteger(jobId) || jobId <= 0) {
      return errorResponse("job_id is required", 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      return errorResponse("A valid work date is required", 400);
    }
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      return errorResponse("Hours must be greater than 0 and no more than 24", 400);
    }
    if (!workCompleted) {
      return errorResponse("Work completed is required", 400);
    }

    await db.prepare(CREATE_TABLE).run();
    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO job_work_logs
        (id, job_id, work_date, hours, supervisor, supervision_type, competency,
         work_completed, tests_results, issues_notes, supervisor_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, jobId, workDate, hours, supervisor || null, supervisionType, competency,
      workCompleted, testsResults || null, issuesNotes || null, supervisorNotes || null
    ).run();

    return Response.json({ ok: true, id, message: "Daily record saved" });
  } catch (error) {
    console.error("Job work logs POST error:", error);
    return errorResponse("Unable to save daily record", 500, error.message);
  }
}
