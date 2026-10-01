import { ensureCustomerInvoiceSchema, ensureInternalCostingSchema } from "./_schema.js";

const INVOICE_STATUSES = new Set(["draft", "issued", "paid", "void"]);
const SOLECTRICS_GST_NUMBER = "137-174-537";
const MATERIALS_TABLE = `
  CREATE TABLE IF NOT EXISTS job_materials (
    id TEXT PRIMARY KEY,
    job_id INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'supplier_invoice',
    supplier_name TEXT,
    invoice_number TEXT,
    invoice_date TEXT,
    invoice_file_id TEXT,
    description TEXT NOT NULL,
    supplier_sku TEXT,
    quantity REAL NOT NULL DEFAULT 1,
    unit_code TEXT,
    unit_cost_ex_gst REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

function errorResponse(message, status = 500, detail) {
  return Response.json({ ok: false, error: message, ...(detail ? { detail } : {}) }, { status });
}

function cleanText(value, limit = 1000) {
  return String(value ?? "").trim().slice(0, limit);
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isoDate(value) {
  const text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
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

async function loadInvoiceSource(db, jobId, requestedOptionId) {
  await ensureInternalCostingSchema(db);
  await db.prepare(MATERIALS_TABLE).run();
  const options = await db.prepare(`
    SELECT id, name, status, default_markup_percent
    FROM costing_options WHERE job_id = ? ORDER BY created_at, name
  `).bind(jobId).all();
  const optionList = options.results || [];
  const option = optionList.find(item => item.id === requestedOptionId) || optionList[0] || null;
  const lines = option ? await db.prepare(`
    SELECT id, description, unit_code, quantity, customer_unit_price, category,
           display_mode, combine_label
    FROM costing_lines
    WHERE job_id = ? AND (option_id = ? OR option_id IS NULL)
    ORDER BY sort_order, created_at
  `).bind(jobId, option.id).all() : { results: [] };
  const materials = await db.prepare(`
    SELECT COALESCE(SUM(quantity * unit_cost_ex_gst), 0) AS actual_cost
    FROM job_materials WHERE job_id = ?
  `).bind(jobId).first();
  return {
    option,
    lines: lines.results || [],
    actual_materials_cost: money(materials?.actual_cost || 0)
  };
}

export function buildInvoiceLines(source) {
  const result = [];
  const combined = new Map();
  const actualCost = money(source.actual_materials_cost);
  const markup = Number(source.option?.default_markup_percent) || 0;
  const actualCustomerCharge = money(actualCost * (1 + markup / 100));

  for (const line of source.lines || []) {
    if (line.category === "materials" && actualCost) continue;
    const quantity = Number(line.quantity) || 0;
    const unitPrice = Number(line.customer_unit_price) || 0;
    const total = money(quantity * unitPrice);
    if (!total) continue;
    if (line.display_mode === "combine" || line.display_mode === "hide") {
      const label = cleanText(line.combine_label, 300) ||
        (line.category === "labour" ? "Electrical labour" : "Supply and installation");
      combined.set(label, money((combined.get(label) || 0) + total));
    } else {
      result.push({
        description: cleanText(line.description, 1000),
        quantity: money(quantity),
        unit: cleanText(line.unit_code, 40) || "item",
        unit_price_ex_gst: money(unitPrice),
        total_ex_gst: total,
        source: "costing"
      });
    }
  }
  for (const [description, total] of combined) {
    result.push({ description, quantity: 1, unit: "item", unit_price_ex_gst: total, total_ex_gst: total, source: "costing" });
  }
  if (actualCost) {
    result.push({
      description: "Electrical materials",
      quantity: 1,
      unit: "item",
      unit_price_ex_gst: actualCustomerCharge,
      total_ex_gst: actualCustomerCharge,
      source: "actual_materials",
      internal_cost_ex_gst: actualCost,
      markup_percent: markup
    });
  }
  return result;
}

function sourceForHash(source) {
  return {
    option_id: source.option?.id || null,
    default_markup_percent: Number(source.option?.default_markup_percent) || 0,
    actual_materials_cost: source.actual_materials_cost,
    lines: buildInvoiceLines(source)
  };
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    if (!db) return errorResponse("D1 database binding DB is not available");
    await ensureCustomerInvoiceSchema(db);
    const url = new URL(context.request.url);
    const invoiceId = url.searchParams.get("invoice_id");
    if (invoiceId) {
      const row = await db.prepare(`
        SELECT id, job_id, version_number, status, snapshot_json, created_at,
               issued_at, paid_at, voided_at
        FROM customer_invoice_versions WHERE id = ?
      `).bind(invoiceId).first();
      if (!row) return errorResponse("Customer invoice not found", 404);
      return Response.json({ ok: true, invoice: { ...row, snapshot: parseSnapshot(row), snapshot_json: undefined } });
    }

    const jobId = Number(url.searchParams.get("job_id"));
    if (!Number.isInteger(jobId) || jobId <= 0) return errorResponse("job_id is required", 400);
    const result = await db.prepare(`
      SELECT id, job_id, version_number, status, snapshot_json, source_hash,
             created_at, issued_at, paid_at, voided_at
      FROM customer_invoice_versions WHERE job_id = ? ORDER BY version_number DESC
    `).bind(jobId).all();
    const rows = result.results || [];
    const versions = rows.map(row => {
      const snapshot = parseSnapshot(row);
      return {
        id: row.id, version_number: row.version_number, status: row.status,
        created_at: row.created_at, issued_at: row.issued_at, paid_at: row.paid_at,
        voided_at: row.voided_at, invoice_number: snapshot?.invoice_number || "",
        total_incl_gst: snapshot?.totals?.total_incl_gst || 0
      };
    });
    const latest = rows[0];
    let costingChanged = false;
    let defaults = null;
    if (latest) {
      const snap = parseSnapshot(latest);
      defaults = {
        business_name: snap?.business?.name || "Solectrics",
        gst_number: snap?.business?.gst_number || SOLECTRICS_GST_NUMBER,
        business_email: snap?.business?.email || "tom@solectrics.co.nz",
        payment_instructions: snap?.payment?.instructions || "",
        payment_terms: snap?.payment?.terms || ""
      };
      const source = await loadInvoiceSource(db, jobId, snap?.source_option_id);
      costingChanged = latest.source_hash !== await sha256(sourceForHash(source));
    }
    return Response.json({ ok: true, versions, costing_changed: costingChanged, defaults });
  } catch (error) {
    console.error("Customer invoices GET error:", error);
    return errorResponse("Unable to load customer invoices", 500, error.message);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) return errorResponse("D1 database binding DB is not available");
    await ensureCustomerInvoiceSchema(db);
    const body = await context.request.json();

    if (body.action === "set_status") {
      const invoiceId = cleanText(body.invoice_id, 100);
      const status = cleanText(body.status, 20);
      if (!invoiceId || !INVOICE_STATUSES.has(status)) return errorResponse("A valid invoice and status are required", 400);
      const existing = await db.prepare("SELECT job_id, status FROM customer_invoice_versions WHERE id = ?").bind(invoiceId).first();
      if (!existing) return errorResponse("Customer invoice not found", 404);
      if (existing.status === "void" && status !== "void") return errorResponse("A void invoice cannot be changed", 409);
      await db.prepare(`
        UPDATE customer_invoice_versions SET status = ?,
          issued_at = CASE WHEN ? = 'issued' AND issued_at IS NULL THEN CURRENT_TIMESTAMP ELSE issued_at END,
          paid_at = CASE WHEN ? = 'paid' AND paid_at IS NULL THEN CURRENT_TIMESTAMP ELSE paid_at END,
          voided_at = CASE WHEN ? = 'void' AND voided_at IS NULL THEN CURRENT_TIMESTAMP ELSE voided_at END
        WHERE id = ?
      `).bind(status, status, status, status, invoiceId).run();
      if (status === "issued") {
        await db.prepare("UPDATE jobs SET job_status = 'invoiced', next_action = 'Await customer payment' WHERE id = ?").bind(existing.job_id).run();
      } else if (status === "paid") {
        await db.prepare("UPDATE jobs SET job_status = 'invoiced', next_action = 'Payment received' WHERE id = ?").bind(existing.job_id).run();
      }
      return Response.json({ ok: true });
    }

    if (body.action !== "generate") return errorResponse("Unknown invoice action", 400);
    const jobId = Number(body.job_id);
    if (!Number.isInteger(jobId) || jobId <= 0) return errorResponse("job_id is required", 400);
    const issueDate = isoDate(body.issue_date);
    const dueDate = isoDate(body.due_date);
    if (!issueDate || !dueDate) return errorResponse("Invoice date and due date are required", 400);
    if (dueDate < issueDate) return errorResponse("Due date cannot be before the invoice date", 400);
    const gstNumber = cleanText(body.gst_number, 40);
    if (!gstNumber) return errorResponse("Enter the Solectrics GST number before creating the invoice", 400);
    const paymentInstructions = cleanText(body.payment_instructions, 1000);
    if (!paymentInstructions) return errorResponse("Enter payment instructions before creating the invoice", 400);

    const job = await db.prepare(`
      SELECT jobs.id AS job_id, jobs.job_type, enquiries.customer_name, enquiries.address,
             enquiries.email, enquiries.phone
      FROM jobs JOIN enquiries ON jobs.enquiry_id = enquiries.id WHERE jobs.id = ?
    `).bind(jobId).first();
    if (!job) return errorResponse("Job not found", 404);
    const source = await loadInvoiceSource(db, jobId, cleanText(body.option_id, 100));
    const lines = buildInvoiceLines(source);
    if (!lines.length) return errorResponse("Add labour, materials or another customer charge before creating the invoice", 400);
    const subtotal = money(lines.reduce((sum, line) => sum + line.total_ex_gst, 0));
    const gst = money(subtotal * 0.15);
    const maxRow = await db.prepare("SELECT COALESCE(MAX(version_number), 0) AS maximum FROM customer_invoice_versions WHERE job_id = ?").bind(jobId).first();
    const version = Number(maxRow?.maximum || 0) + 1;
    const snapshot = {
      invoice_number: `INV-${String(jobId).padStart(4, "0")}-${version}`,
      job_id: jobId,
      job_type: job.job_type || "general_electrical",
      version,
      generated_at: new Date().toISOString(),
      issue_date: issueDate,
      due_date: dueDate,
      source_option_id: source.option?.id || null,
      business: {
        name: cleanText(body.business_name, 200) || "Solectrics",
        gst_number: gstNumber,
        email: cleanText(body.business_email, 200) || "tom@solectrics.co.nz",
        address: ["39 Bay Rd", "Ostend", "Waiheke Island 1081"]
      },
      customer: {
        name: job.customer_name || "", address: job.address || "",
        email: job.email || "", phone: job.phone || ""
      },
      lines,
      totals: { subtotal_ex_gst: subtotal, gst, total_incl_gst: money(subtotal + gst) },
      payment: {
        terms: cleanText(body.payment_terms, 500),
        instructions: paymentInstructions
      },
      notes: cleanText(body.notes, 1000),
      currency: "NZD",
      gst_rate: 0.15
    };
    const invoiceId = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO customer_invoice_versions (id, job_id, version_number, status, snapshot_json, source_hash)
      VALUES (?, ?, ?, 'draft', ?, ?)
    `).bind(invoiceId, jobId, version, JSON.stringify(snapshot), await sha256(sourceForHash(source))).run();
    return Response.json({ ok: true, invoice_id: invoiceId, version_number: version, invoice_number: snapshot.invoice_number });
  } catch (error) {
    console.error("Customer invoices POST error:", error);
    return errorResponse("Unable to generate customer invoice", 500, error.message);
  }
}
