import { sanitise, onRequestPost as readBill } from "./read-bill.js";

export const BILL_FIELDS = [
  "retailer", "plan_name", "icp", "billing_period_start", "billing_period_end", "billing_days",
  "total_import_kwh", "average_daily_kwh", "charged_import_kwh", "free_import_kwh",
  "total_export_kwh", "total_bill_nzd", "electricity_charges_nzd", "non_electricity_charges_nzd",
  "gst_nzd", "electricity_gst_nzd", "electricity_cost_separation_status",
  "daily_fixed_charge_cents", "daily_fixed_charge_gst_basis", "import_rate_cents", "import_rate_gst_basis",
  "peak_rate_cents", "offpeak_rate_cents", "controlled_rate_cents", "ev_night_rate_cents",
  "export_rate_cents", "peak_export_rate_cents", "tariff_description", "free_import_schedule",
  "fixed_term", "exit_cost_nzd", "other_tariff_information", "notes"
];
export function parseEnergyAnswers(value) {
  try { const x = JSON.parse(value || "{}"); return x && typeof x === "object" && !Array.isArray(x) ? x : {}; }
  catch { throw new Error("Saved energy answers cannot be read. No update was made."); }
}
export function sharedBills(answers) {
  const active = answers.energy_data?.active_slot;
  const slots = active === "winter" ? ["winter", "summer"] : ["summer", "winter"];
  return slots.map(slot => answers.bills?.[slot]).filter(Boolean);
}
export function sharedIdentity(answers) {
  const bill = sharedBills(answers)[0] || {};
  return { icp: answers.icp || bill.icp || "", retailer: bill.retailer || "", plan_name: bill.plan_name || "" };
}
export async function energyRevision(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value || ""));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function reply(error, status = 400) { return Response.json({ok:false,error}, {status,headers:{"Cache-Control":"no-store"}}); }
export function validateReviewedBill(value) {
  const filtered = Object.fromEntries(BILL_FIELDS.map(key => [key, value?.[key] ?? null]));
  const bill = sanitise({...filtered, needs_review_fields:[], confidence:null});
  if (!bill.electricity_cost_separation_status) bill.electricity_cost_separation_status = "needs_review";
  for (const key of BILL_FIELDS) {
    if (typeof bill[key] === "number" && bill[key] < 0) throw new Error("Negative bill values need separate credit-bill review.");
    if (filtered[key] !== null && filtered[key] !== "" && bill[key] === null) throw new Error("Check the value or classification for " + key);
  }
  const total = bill.total_import_kwh, charged = bill.charged_import_kwh, free = bill.free_import_kwh;
  if (total !== null && charged !== null && free !== null && Math.abs(charged + free - total) > .05) throw new Error("Charged plus free kWh must equal total imported kWh.");
  if (bill.billing_days !== null && (!Number.isInteger(bill.billing_days) || bill.billing_days <= 0)) throw new Error("Billing days must be a positive whole number.");
  for (const key of ["billing_period_start", "billing_period_end"]) {
    if (bill[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(bill[key]) || new Date(bill[key]).toISOString().slice(0,10) !== bill[key])) throw new Error("Check the billing period dates.");
  }
  if (bill.billing_period_start && bill.billing_period_end && bill.billing_period_start > bill.billing_period_end) throw new Error("Billing end precedes start.");
  const electricity = bill.electricity_charges_nzd, other = bill.non_electricity_charges_nzd, invoice = bill.total_bill_nzd;
  if (invoice !== null && electricity !== null && other !== null && Math.abs(electricity + other - invoice) > .05) throw new Error("Electricity plus other services must reconcile to the invoice total.");
  if (bill.electricity_cost_separation_status === "electricity_only" && other > 0) throw new Error("Other services are present; choose separated or needs review.");
  if (bill.billing_days && total !== null) bill.average_daily_kwh = Number((total / bill.billing_days).toFixed(4));
  return bill;
}
export function applyReviewedBill(answers, {file, draft, bill, slot, now}) {
  const previous = answers.bills?.[slot] ?? null;
  const previousShared = sharedIdentity(answers);
  const review = {source:"post_hec_job_bill", file_id:file.id, original_name:file.original_name,
    extracted:draft.extracted, extracted_at:draft.extracted_at, reviewed:bill, reviewed_at:now,
    previous, previous_shared:previousShared, slot};
  const history = [...(answers.energy_data?.history || []), review];
  return {...answers, bills:{...(answers.bills || {}), [slot]:bill},
    ...(bill.icp ? {icp:bill.icp} : {}),
    energy_data:{...(answers.energy_data || {}), active_slot:slot, revision:crypto.randomUUID(),
      history, drafts:{...(answers.energy_data?.drafts || {}), [file.id]:null},
      limitation:"Bill-period annualisation is indicative. Interval data is needed to quantify solar overlap with free/TOU periods. Existing proposals remain snapshots; regenerate after review."}};
}

export function stagingEnergyEnabled(context) {
  return context.env.JOBHUB_STAGING_ONLY === "true" && context.env.ALLOW_PAGES_DEV_HOST === "true" &&
    ["fletcher-package-mobile-fix.solectrics-jobhub-staging.pages.dev",
     "post-hec-bill-fletcher-priva.solectrics-jobhub-staging.pages.dev"].includes(new URL(context.request.url).hostname);
}

// Extend the already-private /api/job-files route. No new API path or schema.
// This feature cannot run on production until a separately reviewed promotion.
export async function postHecEnergyAction(context) {
  if (!stagingEnergyEnabled(context)) return reply("Post-HEC bill processing is enabled in the approved staging preview only.", 403);
  const body = await context.request.json();
  const jobId = Number(body.job_id), fileId = String(body.file_id || "");
  if (!Number.isInteger(jobId) || jobId <= 0 || !fileId) return reply("Choose a job and its attached bill.");
  if (!["read_energy_bill", "load_energy_bill_review", "save_energy_bill"].includes(body.action)) return reply("Unknown bill action.");
  const db = context.env.DB;
  if (!db) return reply("Database unavailable.", 503);
  const file = await db.prepare(`SELECT f.id, f.original_name, f.content_type, f.size_bytes, f.storage_key, f.document_role,
    e.id AS enquiry_id, e.answers_json FROM job_files f JOIN jobs j ON j.id = f.job_id
    JOIN enquiries e ON e.id = j.enquiry_id WHERE f.id = ? AND f.job_id = ?`).bind(fileId, jobId).first();
  if (!file || !["power_bill", "additional_power_bill"].includes(file.document_role)) return reply("Bill not found for this job.", 404);
  const answers = parseEnergyAnswers(file.answers_json);
  if (body.action === "load_energy_bill_review") return Response.json({ok:true,draft:answers.energy_data?.drafts?.[file.id] || null,
    bills:answers.bills || {},shared:sharedIdentity(answers),revision:await energyRevision(file.answers_json)}, {headers:{"Cache-Control":"no-store"}});
  let next, result;
  if (body.action === "read_energy_bill") {
    const bucket = context.env.JOB_FILES;
    if (!bucket) return reply("Staging job-file storage is unavailable.", 503);
    if (file.size_bytes > 12 * 1024 * 1024) return reply("Bill exceeds the reader size limit.");
    const object = await bucket.get(file.storage_key);
    if (!object) return reply("The attached bill is unavailable. No energy information was changed.", 404);
    const form = new FormData();
    form.append("bill", new File([await object.arrayBuffer()], file.original_name, {type:file.content_type || "application/pdf"}));
    const response = await readBill({...context, request:new Request(context.request.url, {method:"POST",body:form})});
    const extracted = await response.json();
    if (!response.ok || extracted.error) return reply(extracted.error || "Bill reading failed; attachment retained.", 502);
    const draft = {extracted:sanitise(extracted.bill || extracted), extracted_at:new Date().toISOString()};
    next = {...answers, energy_data:{...(answers.energy_data || {}), drafts:{...(answers.energy_data?.drafts || {}), [file.id]:draft}}};
    result = {draft, bills:answers.bills || {}, shared:sharedIdentity(answers)};
  } else {
    if (body.approved !== true) return reply("Review and approve the values before saving.");
    if (!body.revision || body.revision !== await energyRevision(file.answers_json)) return reply("Saved information changed. Reload the bill review before approving.", 409);
    if (!["summer", "winter"].includes(body.slot)) return reply("Choose the summer or winter evidence slot to update.");
    const draft = answers.energy_data?.drafts?.[file.id];
    if (!draft) return reply("Read this attached bill before approving its values.", 409);
    let bill;
    try { bill = validateReviewedBill(body.bill); } catch (error) { return reply(error.message); }
    next = applyReviewedBill(answers, {file,draft,bill,slot:body.slot,now:new Date().toISOString()});
    result = {bill, energy_revision:next.energy_data.revision, shared:sharedIdentity(next)};
  }
  const json = JSON.stringify(next);
  const update = await db.prepare("UPDATE enquiries SET answers_json = ? WHERE id = ? AND answers_json IS ?")
    .bind(json, file.enquiry_id, file.answers_json).run();
  if (update.meta?.changes !== 1) return reply("Saved information changed. Reload the bill review; nothing was overwritten.", 409);
  return Response.json({ok:true,...result,revision:await energyRevision(json)}, {headers:{"Cache-Control":"no-store"}});
}
