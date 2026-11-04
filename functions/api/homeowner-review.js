// Separate homeowner conversation record. The original enquiry/HEC remains read-only.
// Protected by the same Job Hub Cloudflare Access middleware as other /api routes.
const TABLE = `CREATE TABLE IF NOT EXISTS homeowner_reviews (
  job_id INTEGER PRIMARY KEY,
  review_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const CORRECTABLE = new Set([
  "people","homeType","dayHome","workFromHome","loadTiming","hotWater",
  "cylinderSize","hotWaterControl","cylinderCondition","loads","evDayHome",
  "goals","existingSolar","batteryInterest","plannedChanges","roof",
  "direction","shade","roofCondition","energyUsageNotes","financePlan","greenLoanBank"
]);
const GROUPS = new Set(["household","hotwater","loads","plans","roof","bills"]);
const CHOICES = {
  hot_water_interest: new Set(["","timer","diverter","heat_pump","keep","advice"]),
  smart_energy_interest: new Set(["","yes","maybe","no"]),
  tariff_review_interest: new Set(["","yes","maybe","no"]),
  cleaning_interest: new Set(["","yes","maybe","no"])
};

function fail(message, status = 400) {
  return Response.json({ ok:false, error:message }, {status});
}
function validJobId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function string(value, limit = 2000) {
  return typeof value === "string" ? value.trim().slice(0,limit) : "";
}
function checked(value) { return value === true; }
function normalize(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const corrections = {};
  for (const [key, value] of Object.entries(input.corrections || {})) {
    if (CORRECTABLE.has(key) && typeof value === "string") corrections[key] = string(value, 700);
  }
  const reviewed = {};
  for (const [key, value] of Object.entries(input.reviewed || {})) {
    if (GROUPS.has(key)) reviewed[key] = checked(value);
  }
  const result = { corrections, reviewed };
  for (const [key, possible] of Object.entries(CHOICES)) {
    result[key] = possible.has(input[key]) ? input[key] : "";
  }
  result.homeowner_notes = string(input.homeowner_notes,4000);
  result.hot_water_notes = string(input.hot_water_notes,2000);
  result.other_interests = string(input.other_interests,2000);
  result.email_draft = string(input.email_draft,10000);
  result.aftercare_two_week = checked(input.aftercare_two_week);
  result.aftercare_one_month = checked(input.aftercare_one_month);
  result.aftercare_app_support = checked(input.aftercare_app_support);
  result.aftercare_cleaning = checked(input.aftercare_cleaning);
  return result;
}
async function verifyJob(db, id) {
  return db.prepare("SELECT id FROM jobs WHERE id = ?").bind(id).first();
}
export async function onRequestGet({request, env}) {
  const id = validJobId(new URL(request.url).searchParams.get("job_id"));
  if (!id) return fail("Valid job_id required");
  if (!env.DB) return fail("D1 database binding unavailable",500);
  try {
    if (!await verifyJob(env.DB, id)) return fail("Job not found",404);
    await env.DB.prepare(TABLE).run();
    const row = await env.DB.prepare("SELECT review_json, updated_at FROM homeowner_reviews WHERE job_id=?").bind(id).first();
    return Response.json({ok:true, review: row ? JSON.parse(row.review_json) : null, updated_at:row?.updated_at || null});
  } catch(err) {
    console.error("Homeowner review GET:",err);
    return fail("Could not load homeowner review",500);
  }
}
export async function onRequestPost({request, env}) {
  if (!env.DB) return fail("D1 database binding unavailable",500);
  try {
    const raw = await request.text();
    if (raw.length > 24000) return fail("Homeowner review is too large",413);
    const body = JSON.parse(raw);
    const id = validJobId(body.job_id);
    if (!id) return fail("Valid job_id required");
    const review = normalize(body.review);
    if (!review) return fail("Review must be an object");
    if (!await verifyJob(env.DB,id)) return fail("Job not found",404);
    await env.DB.prepare(TABLE).run();
    await env.DB.prepare(`INSERT INTO homeowner_reviews(job_id,review_json,updated_at)
      VALUES(?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(job_id) DO UPDATE SET
      review_json=excluded.review_json,updated_at=CURRENT_TIMESTAMP`)
      .bind(id,JSON.stringify(review)).run();
    return Response.json({ok:true,review});
  } catch(err) {
    console.error("Homeowner review POST:",err);
    return fail("Could not save homeowner review",500);
  }
}
