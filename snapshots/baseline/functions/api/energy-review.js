import { compareTariffs } from "./_energy-calculator.js";

const REVIEW_TABLE = `
  CREATE TABLE IF NOT EXISTS energy_reviews (
    job_id INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'draft',
    current_plan_json TEXT NOT NULL DEFAULT '{}',
    baseline_json TEXT NOT NULL DEFAULT '{}',
    proposed_system_json TEXT NOT NULL DEFAULT '{}',
    scenario_json TEXT NOT NULL DEFAULT '{}',
    model_json TEXT NOT NULL DEFAULT '{}',
    assumptions_json TEXT NOT NULL DEFAULT '[]',
    selected_scenario TEXT NOT NULL DEFAULT 'solar_smart',
    customer_summary TEXT,
    tariffs_checked_date TEXT,
    consumption_period_start TEXT,
    consumption_period_end TEXT,
    post_install_review_due TEXT,
    post_install_actuals_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;

const TARIFF_TABLE = `
  CREATE TABLE IF NOT EXISTS job_energy_tariffs (
    id TEXT PRIMARY KEY,
    job_id INTEGER NOT NULL,
    retailer TEXT NOT NULL,
    plan_name TEXT NOT NULL,
    product_code TEXT,
    pricing_type TEXT NOT NULL DEFAULT 'needs_review',
    network_region TEXT,
    daily_charge_cents REAL,
    standard_import_rate_cents REAL,
    peak_import_rate_cents REAL,
    offpeak_import_rate_cents REAL,
    controlled_import_rate_cents REAL,
    ev_night_rate_cents REAL,
    solar_export_rate_cents REAL,
    peak_solar_export_rate_cents REAL,
    peak_import_periods_json TEXT NOT NULL DEFAULT '[]',
    offpeak_import_periods_json TEXT NOT NULL DEFAULT '[]',
    peak_export_periods_json TEXT NOT NULL DEFAULT '[]',
    annual_fees_nzd REAL,
    transition_cost_nzd REAL,
    exit_cost_nzd REAL,
    eligibility_conditions TEXT,
    source_name TEXT,
    source_url TEXT,
    source_format TEXT NOT NULL DEFAULT 'manual',
    source_record_id TEXT,
    effective_date TEXT,
    last_verified_date TEXT,
    notes TEXT,
    is_current_plan INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;

const JSON_FIELDS = [
  "current_plan", "baseline", "proposed_system", "scenario", "model", "assumptions"
];
const TARIFF_NUMBER_FIELDS = [
  "daily_charge_cents", "standard_import_rate_cents", "peak_import_rate_cents",
  "offpeak_import_rate_cents", "controlled_import_rate_cents", "ev_night_rate_cents",
  "solar_export_rate_cents", "peak_solar_export_rate_cents", "annual_fees_nzd",
  "transition_cost_nzd", "exit_cost_nzd"
];

function error(message, status = 500, detail) {
  return Response.json({ ok: false, error: message, ...(detail ? { detail } : {}) }, { status });
}

function object(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch { return fallback; }
}

function array(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || ""); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

function text(value, max = 2000) {
  return value === null || value === undefined ? "" : String(value).trim().slice(0, max);
}

function number(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isoDate(value) {
  const cleaned = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : null;
}

function safeUrl(value) {
  const cleaned = text(value, 1000);
  if (!cleaned) return "";
  try {
    const parsed = new URL(cleaned);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch { return ""; }
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(REVIEW_TABLE),
    db.prepare(TARIFF_TABLE),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_job_energy_tariffs_job ON job_energy_tariffs(job_id, updated_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_job_energy_tariffs_source ON job_energy_tariffs(retailer, product_code, effective_date)")
  ]);
}

async function optionalFirst(db, sql, value) {
  try { return await db.prepare(sql).bind(value).first(); }
  catch { return null; }
}

async function optionalAll(db, sql, value) {
  try { const result = await db.prepare(sql).bind(value).all(); return result.results || []; }
  catch { return []; }
}

function billValues(answers) {
  return [answers?.bills?.summer, answers?.bills?.winter].filter(Boolean);
}

function firstKnown(bills, key) {
  return bills.map(bill => bill?.[key]).find(value => value !== null && value !== undefined && value !== "") ?? null;
}

function deriveCurrentPlan(answers = {}) {
  const bills = billValues(answers);
  return {
    retailer: firstKnown(bills, "retailer") || "",
    plan_name: firstKnown(bills, "plan_name") || "",
    icp: firstKnown(bills, "icp") || "",
    billing_period_start: firstKnown(bills, "billing_period_start") || "",
    billing_period_end: firstKnown(bills, "billing_period_end") || "",
    daily_charge_cents: firstKnown(bills, "daily_fixed_charge_cents"),
    standard_import_rate_cents: firstKnown(bills, "import_rate_cents"),
    peak_import_rate_cents: firstKnown(bills, "peak_rate_cents"),
    offpeak_import_rate_cents: firstKnown(bills, "offpeak_rate_cents"),
    controlled_import_rate_cents: firstKnown(bills, "controlled_rate_cents"),
    ev_night_rate_cents: firstKnown(bills, "ev_night_rate_cents"),
    solar_export_rate_cents: firstKnown(bills, "export_rate_cents"),
    fixed_term: firstKnown(bills, "fixed_term") || "needs_review",
    exit_cost_nzd: firstKnown(bills, "exit_cost_nzd"),
    other_tariff_information: firstKnown(bills, "other_tariff_information") || "",
    notes: bills.map(bill => bill?.notes).filter(Boolean).join(" ")
  };
}

function deriveBaseline(answers = {}, files = []) {
  const bills = billValues(answers);
  const dailyUse = bills.map(bill => number(bill.average_daily_kwh)).filter(value => value !== null);
  const dailySpend = bills.map(bill => {
    const total = number(bill.total_bill_nzd);
    const days = number(bill.billing_days);
    return total !== null && days ? total / days : null;
  }).filter(value => value !== null);
  const interval = files.some(file => file.document_role === "annual_usage" && file.energy_data_detail === "half_hourly");
  const annualFiles = files.filter(file => file.document_role === "annual_usage");
  const startDates = bills.map(bill => bill.billing_period_start).filter(Boolean).sort();
  const endDates = bills.map(bill => bill.billing_period_end).filter(Boolean).sort();
  return {
    annual_consumption_kwh: dailyUse.length ? Math.round((dailyUse.reduce((a, b) => a + b, 0) / dailyUse.length) * 365) : null,
    annual_expenditure_nzd: dailySpend.length ? Math.round((dailySpend.reduce((a, b) => a + b, 0) / dailySpend.length) * 365) : null,
    average_daily_consumption_kwh: dailyUse.length ? Number((dailyUse.reduce((a, b) => a + b, 0) / dailyUse.length).toFixed(2)) : null,
    annual_fixed_charges_nzd: number(firstKnown(bills, "daily_fixed_charge_cents")) !== null
      ? Number((number(firstKnown(bills, "daily_fixed_charge_cents")) * 3.65).toFixed(2)) : null,
    monthly_consumption: [],
    seasonal_pattern: bills.length > 1 ? "Summer and winter bills supplied" : "Needs review",
    controlled_load_consumption_kwh: null,
    peak_consumption_kwh: null,
    offpeak_consumption_kwh: null,
    data_quality: interval
      ? "Interval consumption data uploaded — validate before detailed modelling"
      : bills.length > 1
        ? "Seasonal electricity bills supplied — indicative modelling"
        : bills.length === 1
          ? "Single billing period supplied — indicative modelling"
        : annualFiles.length
          ? "Annual usage file uploaded — needs review"
          : "Needs review",
    data_quality_code: interval ? "interval_uploaded" : bills.length ? "billing_indicative" : "needs_review",
    consumption_period_start: startDates[0] || "",
    consumption_period_end: endDates[endDates.length - 1] || ""
  };
}

function deriveProposedSystem(answers = {}, assessment = {}, design = {}) {
  const loads = Array.isArray(answers.loads) ? answers.loads.map(value => String(value).toLowerCase()) : [];
  const planned = Array.isArray(answers.plannedChanges) ? answers.plannedChanges.map(value => String(value).toLowerCase()) : [];
  const has = term => [...loads, ...planned].some(value => value.includes(term));
  const batteryKwh = number(design.design_battery_kwh) ?? number(assessment.battery_kwh);
  return {
    solar_array_kw: number(design.design_array_kw) ?? number(assessment.solar_kw),
    estimated_annual_solar_generation_kwh: number(assessment.estimated_generation_kwh),
    inverter_model: design.design_inverter_model || assessment.inverter || "",
    inverter_size_kw: number(design.design_inverter_kw),
    battery: batteryKwh !== null || Boolean(design.design_battery_model),
    battery_capacity_kwh: batteryKwh,
    eps_backup: design.design_backup || "",
    hot_water_cylinder: String(answers.hotWater || "").toLowerCase().includes("cylinder"),
    smart_hot_water_timer: false,
    solar_diverter: false,
    hot_water_heat_pump: String(answers.hotWater || "").toLowerCase().includes("heat-pump") || has("hot-water heat pump"),
    ev: has("ev") || has("electric vehicle"),
    ev_charging_strategy: "",
    pool: has("pool"),
    spa: has("spa"),
    pool_pump_scheduling: false,
    other_flexible_loads: assessment.smart_controls || ""
  };
}

function decodeReview(row) {
  if (!row) return null;
  const review = { ...row };
  for (const field of JSON_FIELDS) {
    const column = `${field}_json`;
    review[field] = field === "assumptions" ? array(row[column]) : object(row[column]);
    delete review[column];
  }
  review.model.model_ready = Boolean(review.model.model_ready);
  return review;
}

function decodeTariff(row) {
  return {
    ...row,
    is_current_plan: Boolean(row.is_current_plan),
    peak_import_periods: array(row.peak_import_periods_json),
    offpeak_import_periods: array(row.offpeak_import_periods_json),
    peak_export_periods: array(row.peak_export_periods_json),
    source_complete: Boolean(row.source_url && (row.last_verified_date || row.effective_date))
  };
}

async function loadBundle(db, jobId) {
  const job = await optionalFirst(db, `
    SELECT jobs.id AS job_id, enquiries.customer_name, enquiries.address, enquiries.answers_json
    FROM jobs JOIN enquiries ON jobs.enquiry_id = enquiries.id WHERE jobs.id = ?`, jobId);
  if (!job) return null;
  const answers = object(job.answers_json);
  const [assessment, designRow, files, reviewRow, tariffRows] = await Promise.all([
    optionalFirst(db, "SELECT * FROM assessments WHERE job_id = ?", jobId),
    optionalFirst(db, "SELECT data_json FROM system_designs WHERE job_id = ?", jobId),
    optionalAll(db, "SELECT document_role, energy_data_detail, original_name, uploaded_at FROM job_files WHERE job_id = ?", jobId),
    optionalFirst(db, "SELECT * FROM energy_reviews WHERE job_id = ?", jobId),
    optionalAll(db, "SELECT * FROM job_energy_tariffs WHERE job_id = ? ORDER BY is_current_plan DESC, updated_at DESC", jobId)
  ]);
  const derived = {
    current_plan: deriveCurrentPlan(answers),
    baseline: deriveBaseline(answers, files),
    proposed_system: deriveProposedSystem(answers, assessment || {}, object(designRow?.data_json))
  };
  const saved = decodeReview(reviewRow);
  const review = saved || {
    job_id: jobId,
    status: "draft",
    ...derived,
    scenario: {},
    model: { model_ready: false },
    assumptions: [],
    selected_scenario: "solar_smart",
    customer_summary: "",
    tariffs_checked_date: "",
    consumption_period_start: derived.baseline.consumption_period_start,
    consumption_period_end: derived.baseline.consumption_period_end,
    post_install_review_due: ""
  };
  const tariffs = tariffRows.map(decodeTariff);
  const comparisons = review.model?.model_ready ? compareTariffs(review.model, tariffs) : [];
  return {
    customer: { name: job.customer_name, address: job.address },
    review,
    derived,
    files,
    tariffs,
    comparisons,
    future_import: { format: "EIEP14A", status: "prepared_not_built" }
  };
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    if (!db) return error("D1 database binding DB is not available");
    const jobId = Number(new URL(context.request.url).searchParams.get("job_id"));
    if (!Number.isInteger(jobId) || jobId <= 0) return error("job_id is required", 400);
    await ensureSchema(db);
    const bundle = await loadBundle(db, jobId);
    if (!bundle) return error("Job not found", 404);
    return Response.json({ ok: true, ...bundle });
  } catch (cause) {
    console.error("Energy review GET error:", cause);
    return error("Unable to load energy review", 500, cause.message);
  }
}

function sanitiseReview(value = {}) {
  const status = ["draft", "ready_for_review", "discuss_with_customer", "completed"].includes(value.status)
    ? value.status : "draft";
  const selectedScenario = ["current", "solar_only", "solar_smart", "solar_battery", "solar_battery_smart"].includes(value.selected_scenario)
    ? value.selected_scenario : "solar_smart";
  return {
    status,
    current_plan: object(value.current_plan),
    baseline: object(value.baseline),
    proposed_system: object(value.proposed_system),
    scenario: object(value.scenario),
    model: object(value.model),
    assumptions: Array.isArray(value.assumptions) ? value.assumptions.map(item => text(item, 1000)).filter(Boolean).slice(0, 30) : [],
    selected_scenario: selectedScenario,
    customer_summary: text(value.customer_summary, 5000),
    tariffs_checked_date: isoDate(value.tariffs_checked_date),
    consumption_period_start: isoDate(value.consumption_period_start),
    consumption_period_end: isoDate(value.consumption_period_end),
    post_install_review_due: isoDate(value.post_install_review_due)
  };
}

function sanitiseTariff(value = {}, jobId) {
  const tariff = {
    id: text(value.id, 80) || crypto.randomUUID(),
    job_id: jobId,
    retailer: text(value.retailer, 200),
    plan_name: text(value.plan_name, 200),
    product_code: text(value.product_code, 200),
    pricing_type: ["flat", "time_of_use", "needs_review"].includes(value.pricing_type) ? value.pricing_type : "needs_review",
    network_region: text(value.network_region, 300),
    peak_import_periods: array(value.peak_import_periods).map(item => text(item, 300)).filter(Boolean),
    offpeak_import_periods: array(value.offpeak_import_periods).map(item => text(item, 300)).filter(Boolean),
    peak_export_periods: array(value.peak_export_periods).map(item => text(item, 300)).filter(Boolean),
    eligibility_conditions: text(value.eligibility_conditions, 2000),
    source_name: text(value.source_name, 300),
    source_url: safeUrl(value.source_url),
    source_format: value.source_format === "EIEP14A" ? "EIEP14A" : "manual",
    source_record_id: text(value.source_record_id, 300),
    effective_date: isoDate(value.effective_date),
    last_verified_date: isoDate(value.last_verified_date),
    notes: text(value.notes, 3000),
    is_current_plan: value.is_current_plan ? 1 : 0
  };
  for (const field of TARIFF_NUMBER_FIELDS) tariff[field] = number(value[field]);
  return tariff;
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) return error("D1 database binding DB is not available");
    const body = await context.request.json();
    const jobId = Number(body.job_id);
    if (!Number.isInteger(jobId) || jobId <= 0) return error("job_id is required", 400);
    await ensureSchema(db);

    if (body.action === "save_review") {
      const review = sanitiseReview(body.review);
      const requestedReady = Boolean(review.model.model_ready);
      review.model.model_ready = requestedReady;
      if (requestedReady) {
        const annualConsumption = number(review.model.annual_consumption_kwh);
        const solarGeneration = number(review.model.solar_generation_kwh);
        const gridImports = ["grid_import_standard_kwh", "grid_import_peak_kwh", "grid_import_offpeak_kwh", "grid_import_controlled_kwh", "grid_import_ev_kwh"]
          .reduce((sum, field) => sum + (number(review.model[field]) || 0), 0);
        if (!annualConsumption) return error("Enter annual household consumption before marking the model ready", 400);
        if (review.selected_scenario !== "current" && !solarGeneration) {
          return error("Enter estimated annual solar generation before marking the model ready", 400);
        }
        if (!gridImports) return error("Enter the estimated annual grid imports before marking the model ready", 400);
      }
      await db.prepare(`
        INSERT INTO energy_reviews
          (job_id, status, current_plan_json, baseline_json, proposed_system_json,
           scenario_json, model_json, assumptions_json, selected_scenario, customer_summary,
           tariffs_checked_date, consumption_period_start, consumption_period_end,
           post_install_review_due, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(job_id) DO UPDATE SET
          status=excluded.status, current_plan_json=excluded.current_plan_json,
          baseline_json=excluded.baseline_json, proposed_system_json=excluded.proposed_system_json,
          scenario_json=excluded.scenario_json, model_json=excluded.model_json,
          assumptions_json=excluded.assumptions_json, selected_scenario=excluded.selected_scenario,
          customer_summary=excluded.customer_summary, tariffs_checked_date=excluded.tariffs_checked_date,
          consumption_period_start=excluded.consumption_period_start,
          consumption_period_end=excluded.consumption_period_end,
          post_install_review_due=excluded.post_install_review_due, updated_at=CURRENT_TIMESTAMP
      `).bind(
        jobId, review.status, JSON.stringify(review.current_plan), JSON.stringify(review.baseline),
        JSON.stringify(review.proposed_system), JSON.stringify(review.scenario), JSON.stringify(review.model),
        JSON.stringify(review.assumptions), review.selected_scenario, review.customer_summary || null,
        review.tariffs_checked_date, review.consumption_period_start, review.consumption_period_end,
        review.post_install_review_due
      ).run();
    } else if (body.action === "save_tariff") {
      const tariff = sanitiseTariff(body.tariff, jobId);
      if (!tariff.retailer || !tariff.plan_name) return error("Retailer and plan name are required", 400);
      const existingTariff = await db.prepare("SELECT job_id FROM job_energy_tariffs WHERE id = ?").bind(tariff.id).first();
      if (existingTariff && Number(existingTariff.job_id) !== jobId) return error("Tariff record does not belong to this Job", 403);
      if (!existingTariff) {
        const countRow = await db.prepare("SELECT COUNT(*) AS total FROM job_energy_tariffs WHERE job_id = ?").bind(jobId).first();
        if (Number(countRow?.total || 0) >= 5) return error("This review already has five plans. Edit or remove a plan before adding another.", 400);
      }
      if (tariff.is_current_plan) {
        await db.prepare("UPDATE job_energy_tariffs SET is_current_plan = 0 WHERE job_id = ?").bind(jobId).run();
      }
      await db.prepare(`
        INSERT INTO job_energy_tariffs
          (id, job_id, retailer, plan_name, product_code, pricing_type, network_region, daily_charge_cents,
           standard_import_rate_cents, peak_import_rate_cents, offpeak_import_rate_cents,
           controlled_import_rate_cents, ev_night_rate_cents, solar_export_rate_cents,
           peak_solar_export_rate_cents, peak_import_periods_json, offpeak_import_periods_json,
           peak_export_periods_json, annual_fees_nzd, transition_cost_nzd, exit_cost_nzd,
           eligibility_conditions, source_name, source_url, source_format, source_record_id,
           effective_date, last_verified_date, notes, is_current_plan, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          retailer=excluded.retailer, plan_name=excluded.plan_name, product_code=excluded.product_code,
          pricing_type=excluded.pricing_type,
          network_region=excluded.network_region, daily_charge_cents=excluded.daily_charge_cents,
          standard_import_rate_cents=excluded.standard_import_rate_cents,
          peak_import_rate_cents=excluded.peak_import_rate_cents,
          offpeak_import_rate_cents=excluded.offpeak_import_rate_cents,
          controlled_import_rate_cents=excluded.controlled_import_rate_cents,
          ev_night_rate_cents=excluded.ev_night_rate_cents,
          solar_export_rate_cents=excluded.solar_export_rate_cents,
          peak_solar_export_rate_cents=excluded.peak_solar_export_rate_cents,
          peak_import_periods_json=excluded.peak_import_periods_json,
          offpeak_import_periods_json=excluded.offpeak_import_periods_json,
          peak_export_periods_json=excluded.peak_export_periods_json,
          annual_fees_nzd=excluded.annual_fees_nzd, transition_cost_nzd=excluded.transition_cost_nzd,
          exit_cost_nzd=excluded.exit_cost_nzd, eligibility_conditions=excluded.eligibility_conditions,
          source_name=excluded.source_name, source_url=excluded.source_url,
          source_format=excluded.source_format, source_record_id=excluded.source_record_id,
          effective_date=excluded.effective_date, last_verified_date=excluded.last_verified_date,
          notes=excluded.notes, is_current_plan=excluded.is_current_plan, updated_at=CURRENT_TIMESTAMP
      `).bind(
        tariff.id, jobId, tariff.retailer, tariff.plan_name, tariff.product_code || null,
        tariff.pricing_type, tariff.network_region || null, tariff.daily_charge_cents, tariff.standard_import_rate_cents,
        tariff.peak_import_rate_cents, tariff.offpeak_import_rate_cents, tariff.controlled_import_rate_cents,
        tariff.ev_night_rate_cents, tariff.solar_export_rate_cents, tariff.peak_solar_export_rate_cents,
        JSON.stringify(tariff.peak_import_periods), JSON.stringify(tariff.offpeak_import_periods),
        JSON.stringify(tariff.peak_export_periods), tariff.annual_fees_nzd, tariff.transition_cost_nzd,
        tariff.exit_cost_nzd, tariff.eligibility_conditions || null, tariff.source_name || null,
        tariff.source_url || null, tariff.source_format, tariff.source_record_id || null,
        tariff.effective_date, tariff.last_verified_date, tariff.notes || null, tariff.is_current_plan
      ).run();
    } else if (body.action === "delete_tariff") {
      const id = text(body.tariff_id, 80);
      if (!id) return error("tariff_id is required", 400);
      await db.prepare("DELETE FROM job_energy_tariffs WHERE id = ? AND job_id = ?").bind(id, jobId).run();
    } else {
      return error("Unknown action", 400);
    }

    const bundle = await loadBundle(db, jobId);
    return Response.json({ ok: true, ...bundle });
  } catch (cause) {
    console.error("Energy review POST error:", cause);
    return error("Unable to save energy review", 500, cause.message);
  }
}
