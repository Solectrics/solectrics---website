const CREATE_SITE_VISITS_TABLE = `
  CREATE TABLE IF NOT EXISTS site_visits (
    job_id INTEGER PRIMARY KEY,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

export const SITE_VISIT_REQUIRED_FIELDS = [
  ["visit_date", "visit date"],
  ["visit_by", "visited by"],
  ["visit_connection_type", "electrical connection"],
  ["visit_main_supply", "main switch rating"],
  ["visit_switchboard", "existing switchboard"],
  ["visit_roof_length", "roof length"],
  ["visit_roof_width", "roof width"],
  ["visit_roof_pitch", "roof pitch"],
  ["visit_roof_orientation", "roof orientation"],
  ["visit_roof_material", "roof material / profile"],
  ["visit_roof_access", "roof access"]
];

function present(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

export function siteVisitCompletion(siteVisit) {
  const visit = siteVisit && typeof siteVisit === "object" && !Array.isArray(siteVisit)
    ? siteVisit
    : {};
  const missing = SITE_VISIT_REQUIRED_FIELDS
    .filter(([key]) => !present(visit[key]))
    .map(([key, label]) => ({ key, label }));
  return {
    complete: missing.length === 0,
    missing
  };
}

export async function loadSiteVisitCompletion(db, jobId) {
  await db.prepare(CREATE_SITE_VISITS_TABLE).run();

  const job = await db
    .prepare("SELECT job_type FROM jobs WHERE id = ?")
    .bind(jobId)
    .first();

  if (!job) {
    return {
      ok: false,
      status: 404,
      message: "Job not found"
    };
  }

  if ((job.job_type || "solar") === "general_electrical") {
    return {
      ok: true,
      complete: true,
      not_required: true,
      missing: [],
      site_visit: null
    };
  }

  const row = await db
    .prepare("SELECT data_json, updated_at FROM site_visits WHERE job_id = ?")
    .bind(jobId)
    .first();

  if (!row) {
    return {
      ok: true,
      complete: false,
      not_required: false,
      missing: SITE_VISIT_REQUIRED_FIELDS.map(([key, label]) => ({ key, label })),
      site_visit: null
    };
  }

  let siteVisit = {};
  try {
    siteVisit = JSON.parse(row.data_json || "{}");
  } catch {
    siteVisit = {};
  }

  const completion = siteVisitCompletion(siteVisit);
  return {
    ok: true,
    ...completion,
    not_required: false,
    site_visit: { ...siteVisit, updated_at: row.updated_at }
  };
}

export async function assertSiteVisitComplete(db, jobId) {
  const result = await loadSiteVisitCompletion(db, jobId);
  if (!result.ok) return result;
  if (result.complete) return result;

  const missingLabels = result.missing.map(item => item.label);
  return {
    ...result,
    ok: false,
    status: 409,
    message: "Tom's Site Visit must be completed before Assessment & Design or System Design can be saved.",
    detail: missingLabels.length
      ? `Complete the Site Visit first. Still required: ${missingLabels.join(", ")}.`
      : "Complete the Site Visit first."
  };
}
