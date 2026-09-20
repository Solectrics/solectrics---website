import { ensureInternalCostingSchema } from "./_schema.js";

const CATEGORIES = new Set(["materials", "labour", "subcontractor", "certification", "other"]);
const DISPLAY_MODES = new Set(["show", "combine", "hide"]);
const STATUSES = new Set(["draft", "approved"]);

function errorResponse(message, status = 500, detail) {
  return Response.json({ ok: false, error: message, ...(detail ? { detail } : {}) }, { status });
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function number(value, fallback = 0, maximum = 10000000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= maximum ? parsed : fallback;
}

function cleanLine(line, index, optionId, jobId) {
  const description = cleanText(line.description, 1000);
  if (!description) return null;
  const shared = line.scope === "shared";
  return {
    id: cleanText(line.id, 100) || crypto.randomUUID(),
    job_id: jobId,
    option_id: shared ? null : optionId,
    supplier_product_id: cleanText(line.supplier_product_id, 100) || null,
    supplier_name: cleanText(line.supplier_name, 200) || null,
    supplier_sku: cleanText(line.supplier_sku, 100) || null,
    description,
    unit_code: cleanText(line.unit_code, 40) || null,
    quantity: number(line.quantity, 1, 1000000),
    unit_cost: number(line.unit_cost),
    markup_percent: number(line.markup_percent, 0, 1000),
    customer_unit_price: number(line.customer_unit_price),
    category: CATEGORIES.has(line.category) ? line.category : "other",
    display_mode: DISPLAY_MODES.has(line.display_mode) ? line.display_mode : "show",
    combine_label: cleanText(line.combine_label, 300) || null,
    sort_order: index
  };
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    const jobId = Number(new URL(context.request.url).searchParams.get("job_id"));
    if (!db) return errorResponse("D1 database binding DB is not available");
    if (!Number.isInteger(jobId) || jobId <= 0) return errorResponse("job_id is required", 400);

    await ensureInternalCostingSchema(db);
    const options = await db.prepare(`
      SELECT id, name, status, default_markup_percent, created_at, updated_at
      FROM costing_options WHERE job_id = ? ORDER BY created_at, name
    `).bind(jobId).all();
    const lines = await db.prepare(`
      SELECT id, option_id, supplier_product_id, supplier_name, supplier_sku,
             description, unit_code, quantity, unit_cost, markup_percent,
             customer_unit_price, category, display_mode, combine_label, sort_order
      FROM costing_lines WHERE job_id = ? ORDER BY sort_order, created_at
    `).bind(jobId).all();

    return Response.json({ ok: true, options: options.results || [], lines: lines.results || [] });
  } catch (error) {
    console.error("Job costing GET error:", error);
    return errorResponse("Unable to load internal costing", 500, error.message);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) return errorResponse("D1 database binding DB is not available");
    const body = await context.request.json();
    const jobId = Number(body.job_id);
    const option = body.option || {};
    const optionId = cleanText(option.id, 100) || crypto.randomUUID();
    const optionName = cleanText(option.name, 200);
    if (!Number.isInteger(jobId) || jobId <= 0) return errorResponse("job_id is required", 400);
    if (!optionName) return errorResponse("Option name is required", 400);
    if (!Array.isArray(body.lines) || body.lines.length > 300) return errorResponse("Up to 300 costing lines are allowed", 400);

    await ensureInternalCostingSchema(db);
    const existingOption = await db.prepare("SELECT job_id FROM costing_options WHERE id = ?").bind(optionId).first();
    if (existingOption && Number(existingOption.job_id) !== jobId) {
      return errorResponse("Costing option does not belong to this job", 409);
    }
    const lines = body.lines.map((line, index) => cleanLine(line || {}, index, optionId, jobId)).filter(Boolean);
    const statements = [
      db.prepare(`
        INSERT INTO costing_options (id, job_id, name, status, default_markup_percent, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          status = excluded.status,
          default_markup_percent = excluded.default_markup_percent,
          updated_at = CURRENT_TIMESTAMP
      `).bind(optionId, jobId, optionName, STATUSES.has(option.status) ? option.status : "draft", number(option.default_markup_percent, 30, 1000)),
      db.prepare("DELETE FROM costing_lines WHERE job_id = ? AND (option_id = ? OR option_id IS NULL)").bind(jobId, optionId)
    ];
    for (const line of lines) {
      statements.push(db.prepare(`
        INSERT INTO costing_lines (
          id, job_id, option_id, supplier_product_id, supplier_name, supplier_sku,
          description, unit_code, quantity, unit_cost, markup_percent,
          customer_unit_price, category, display_mode, combine_label, sort_order, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        line.id, line.job_id, line.option_id, line.supplier_product_id,
        line.supplier_name, line.supplier_sku, line.description, line.unit_code,
        line.quantity, line.unit_cost, line.markup_percent, line.customer_unit_price,
        line.category, line.display_mode, line.combine_label, line.sort_order
      ));
    }
    await db.batch(statements);
    return Response.json({ ok: true, option_id: optionId, line_count: lines.length, message: "Internal costing saved" });
  } catch (error) {
    console.error("Job costing POST error:", error);
    return errorResponse("Unable to save internal costing", 500, error.message);
  }
}
