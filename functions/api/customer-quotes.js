import { ensureCustomerQuoteSchema, ensureInternalCostingSchema } from "./_schema.js";

const QUOTE_STATUSES = new Set(["draft", "issued", "accepted"]);

function errorResponse(message, status = 500, detail) {
  return Response.json({ ok: false, error: message, ...(detail ? { detail } : {}) }, { status });
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function parseSnapshot(row) {
  try { return JSON.parse(row.snapshot_json); } catch { return null; }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function quoteSource(options, lines) {
  return options.map(option => ({
    id: option.id,
    name: option.name,
    lines: lines.filter(line => !line.option_id || line.option_id === option.id).map(line => ({
      id: line.id,
      description: line.description,
      unit_code: line.unit_code || "",
      quantity: money(line.quantity),
      customer_unit_price: money(line.customer_unit_price),
      display_mode: line.display_mode,
      combine_label: line.combine_label || ""
    }))
  }));
}

export function buildCustomerOptions(options, lines) {
  return options.map(option => {
    const optionLines = lines.filter(line => !line.option_id || line.option_id === option.id);
    const shown = [];
    const combined = new Map();
    let subtotal = 0;
    for (const line of optionLines) {
      const lineTotal = money((Number(line.quantity) || 0) * (Number(line.customer_unit_price) || 0));
      subtotal += lineTotal;
      if (line.display_mode === "hide") continue;
      if (line.display_mode === "combine") {
        const label = String(line.combine_label || "Supply and installation").trim() || "Supply and installation";
        combined.set(label, money((combined.get(label) || 0) + lineTotal));
      } else {
        shown.push({
          description: line.description,
          quantity: money(line.quantity),
          unit: line.unit_code || "",
          unit_price: money(line.customer_unit_price),
          total: lineTotal
        });
      }
    }
    for (const [description, total] of combined) {
      shown.push({ description, quantity: 1, unit: "item", unit_price: total, total });
    }
    subtotal = money(subtotal);
    const gst = money(subtotal * 0.15);
    return { id: option.id, name: option.name, lines: shown, subtotal_ex_gst: subtotal, gst, total_incl_gst: money(subtotal + gst) };
  });
}

async function loadApprovedCosting(db, jobId) {
  const optionResult = await db.prepare(`
    SELECT id, name FROM costing_options WHERE job_id = ? AND status = 'approved' ORDER BY created_at, name
  `).bind(jobId).all();
  const lineResult = await db.prepare(`
    SELECT id, option_id, description, unit_code, quantity, customer_unit_price, display_mode, combine_label, sort_order
    FROM costing_lines WHERE job_id = ? ORDER BY sort_order, created_at
  `).bind(jobId).all();
  return { options: optionResult.results || [], lines: lineResult.results || [] };
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    if (!db) return errorResponse("D1 database binding DB is not available");
    await ensureInternalCostingSchema(db);
    await ensureCustomerQuoteSchema(db);
    const url = new URL(context.request.url);
    const quoteId = url.searchParams.get("quote_id");
    if (quoteId) {
      const row = await db.prepare(`SELECT id, job_id, version_number, status, snapshot_json, created_at, issued_at, accepted_at FROM customer_quote_versions WHERE id = ?`).bind(quoteId).first();
      if (!row) return errorResponse("Customer quote not found", 404);
      return Response.json({ ok: true, quote: { ...row, snapshot: parseSnapshot(row), snapshot_json: undefined } });
    }
    const jobId = Number(url.searchParams.get("job_id"));
    if (!Number.isInteger(jobId) || jobId <= 0) return errorResponse("job_id is required", 400);
    const result = await db.prepare(`
      SELECT id, job_id, version_number, status, snapshot_json, source_hash, created_at, issued_at, accepted_at
      FROM customer_quote_versions WHERE job_id = ? ORDER BY version_number DESC
    `).bind(jobId).all();
    const versions = (result.results || []).map(row => {
      const snapshot = parseSnapshot(row);
      return { id: row.id, version_number: row.version_number, status: row.status, created_at: row.created_at, issued_at: row.issued_at, accepted_at: row.accepted_at, option_count: snapshot?.options?.length || 0 };
    });
    const latestProtected = (result.results || []).find(row => row.status === "issued" || row.status === "accepted");
    let costingChanged = false;
    if (latestProtected) {
      const costing = await loadApprovedCosting(db, jobId);
      costingChanged = latestProtected.source_hash !== await sha256(quoteSource(costing.options, costing.lines));
    }
    return Response.json({ ok: true, versions, costing_changed: costingChanged });
  } catch (error) {
    console.error("Customer quotes GET error:", error);
    return errorResponse("Unable to load customer quotes", 500, error.message);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) return errorResponse("D1 database binding DB is not available");
    await ensureInternalCostingSchema(db);
    await ensureCustomerQuoteSchema(db);
    const body = await context.request.json();
    if (body.action === "set_status") {
      const quoteId = String(body.quote_id || "");
      const status = String(body.status || "");
      if (!quoteId || !QUOTE_STATUSES.has(status)) return errorResponse("A valid quote and status are required", 400);
      const existing = await db.prepare("SELECT status FROM customer_quote_versions WHERE id = ?").bind(quoteId).first();
      if (!existing) return errorResponse("Customer quote not found", 404);
      if (existing.status === "accepted" && status !== "accepted") return errorResponse("An accepted quote cannot be changed", 409);
      await db.prepare(`
        UPDATE customer_quote_versions SET status = ?,
          issued_at = CASE WHEN ? = 'issued' AND issued_at IS NULL THEN CURRENT_TIMESTAMP ELSE issued_at END,
          accepted_at = CASE WHEN ? = 'accepted' AND accepted_at IS NULL THEN CURRENT_TIMESTAMP ELSE accepted_at END
        WHERE id = ?
      `).bind(status, status, status, quoteId).run();
      return Response.json({ ok: true });
    }

    if (body.action !== "generate") return errorResponse("Unknown quote action", 400);
    const jobId = Number(body.job_id);
    if (!Number.isInteger(jobId) || jobId <= 0) return errorResponse("job_id is required", 400);
    const costing = await loadApprovedCosting(db, jobId);
    if (!costing.options.length) return errorResponse("Approve and save at least one costing option before generating the customer quote", 400);
    const job = await db.prepare(`
      SELECT jobs.id AS job_id, jobs.job_type, enquiries.customer_name, enquiries.address, enquiries.email, enquiries.phone
      FROM jobs JOIN enquiries ON jobs.enquiry_id = enquiries.id WHERE jobs.id = ?
    `).bind(jobId).first();
    if (!job) return errorResponse("Job not found", 404);
    const maxRow = await db.prepare("SELECT COALESCE(MAX(version_number), 0) AS maximum FROM customer_quote_versions WHERE job_id = ?").bind(jobId).first();
    const version = Number(maxRow?.maximum || 0) + 1;
    const source = quoteSource(costing.options, costing.lines);
    const quotePrefix = job.job_type === "general_electrical" ? "SEW" : "SOL";
    const template = job.job_type === "general_electrical" ? "general_electrical" : "solar";
    const snapshot = {
      quote_number: `${quotePrefix}-${jobId}-V${version}`,
      job_id: jobId,
      job_type: job.job_type || "solar",
      template,
      terms_version: "2026-09-21",
      version,
      generated_at: new Date().toISOString(),
      business: {
        name: "Solectrics",
        address: ["39 Bay Rd", "Ostend", "Waiheke Island 1081"]
      },
      customer: { name: job.customer_name || "", address: job.address || "", email: job.email || "", phone: job.phone || "" },
      options: buildCustomerOptions(costing.options, costing.lines),
      currency: "NZD",
      gst_rate: 0.15
    };
    const quoteId = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO customer_quote_versions (id, job_id, version_number, status, snapshot_json, source_hash)
      VALUES (?, ?, ?, 'draft', ?, ?)
    `).bind(quoteId, jobId, version, JSON.stringify(snapshot), await sha256(source)).run();
    return Response.json({ ok: true, quote_id: quoteId, version_number: version });
  } catch (error) {
    console.error("Customer quotes POST error:", error);
    return errorResponse("Unable to generate customer quote", 500, error.message);
  }
}
