// Shared supply identity. Reads never migrate or rewrite older source records.
function object(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
const clean = value => String(value ?? "").trim();
const normalise = (key, value) => key === "icp"
  ? clean(value).replace(/\s+/g, "").toUpperCase()
  : clean(value).replace(/\s+/g, " ").toLowerCase();

export function resolveElectricityDetails(job = {}, sources = {}) {
  const answers = object(job.answers_json);
  const bills = [answers.bills?.summer, answers.bills?.winter].filter(Boolean);
  const visit = object(sources.visit);
  const design = object(sources.design);
  const review = object(sources.review);
  const assessment = sources.assessment || {};
  const details = { icp: "", retailer: "", retailer_plan: "", conflicts: [], sources: {} };
  for (const key of ["icp", "retailer", "retailer_plan"]) {
    const billKey = key === "retailer_plan" ? "plan_name" : key;
    const candidates = [
      ["Job", job[key]],
      ["Site visit", visit[key === "icp" ? "visit_icp" : key === "retailer" ? "visit_retailer" : "visit_retailer_plan"], visit.visit_retailer],
      ["Design", design[key === "icp" ? "design_icp" : key === "retailer" ? "design_retailer" : "design_retailer_plan"], design.design_retailer],
      ["Tariff review", review[billKey], review.retailer],
      ["Assessment", key === "retailer" ? assessment.current_retailer : ""],
      ...bills.map((bill, i) => [i === 0 ? "HEC bill 1" : "HEC bill 2", bill[billKey], bill.retailer])
    ].filter(([source, value, retailer]) => clean(value) && (key !== "retailer_plan" || source === "Job" ||
      (details.retailer && normalise("retailer", retailer) === normalise("retailer", details.retailer))));
    const unique = new Set(candidates.map(([, value]) => normalise(key, value)));
    // An explicitly saved job value wins. Conflicting unconfirmed sources must
    // be resolved by a person rather than by source order.
    const selected = clean(job[key]) ? candidates[0] : unique.size === 1 ? candidates[0] : null;
    if (selected) {
      details[key] = key === "icp" ? normalise(key, selected[1]) : clean(selected[1]);
      details.sources[key] = selected[0];
    }
    if (unique.size > 1) details.conflicts.push({ field: key, candidates: candidates.map(([source, value]) => ({ source, value: clean(value) })), confirmed: Boolean(clean(job[key])) });
  }
  return details;
}

async function optional(db, sql, id) {
  try { return await db.prepare(sql).bind(id).first(); }
  catch (error) {
    if (/no such table/i.test(String(error.message || error))) return null;
    throw error;
  }
}

export async function loadElectricityDetails(db, jobId, knownJob) {
  const job = knownJob || await db.prepare(`
    SELECT j.icp, j.retailer, j.retailer_plan, e.answers_json
    FROM jobs j JOIN enquiries e ON e.id = j.enquiry_id WHERE j.id = ?
  `).bind(jobId).first();
  if (!job) return null;
  const [visit, design, review, assessment] = await Promise.all([
    optional(db, "SELECT data_json FROM site_visits WHERE job_id = ?", jobId),
    optional(db, "SELECT data_json FROM system_designs WHERE job_id = ?", jobId),
    optional(db, "SELECT current_plan_json FROM energy_reviews WHERE job_id = ?", jobId),
    optional(db, "SELECT current_retailer FROM assessments WHERE job_id = ?", jobId)
  ]);
  return resolveElectricityDetails(job, { visit: object(visit?.data_json), design: object(design?.data_json), review: object(review?.current_plan_json), assessment });
}
