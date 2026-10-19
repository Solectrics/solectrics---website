const CREATE_TABLE = `
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

function cleanText(value, limit = 500) {
  return String(value ?? "").trim().slice(0, limit);
}

function number(value, fallback, max = 10000000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? parsed : fallback;
}

function money(value, fallback = 0, max = 10000000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= max ? parsed : fallback;
}

async function ensureSchema(db) {
  await db.prepare(CREATE_TABLE).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_job_materials_job ON job_materials(job_id, created_at)").run();
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    const jobId = Number(new URL(context.request.url).searchParams.get("job_id"));
    if (!db) return errorResponse("D1 database binding DB is not available");
    if (!Number.isInteger(jobId) || jobId <= 0) return errorResponse("job_id is required", 400);
    await ensureSchema(db);
    const result = await db.prepare(`
      SELECT m.id, m.source, m.supplier_name, m.invoice_number, m.invoice_date,
             m.invoice_file_id, f.original_name AS invoice_file_name,
             m.description, m.supplier_sku, m.quantity, m.unit_code,
             m.unit_cost_ex_gst, m.created_at
      FROM job_materials m
      LEFT JOIN job_files f ON f.id = m.invoice_file_id AND f.job_id = m.job_id
      WHERE m.job_id = ?
      ORDER BY m.created_at DESC, m.id
    `).bind(jobId).all();
    return Response.json({ ok: true, materials: result.results || [] });
  } catch (error) {
    console.error("Job materials GET error:", error);
    return errorResponse("Unable to load job materials", 500, error.message);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) return errorResponse("D1 database binding DB is not available");
    const body = await context.request.json();
    const jobId = Number(body.job_id);
    const source = body.source === "stock" ? "stock" : "supplier_invoice";
    const description = cleanText(body.description, 1000);
    const quantity = number(body.quantity, 1, 1000000);
    const unitCost = money(body.unit_cost_ex_gst, 0);
    if (!Number.isInteger(jobId) || jobId <= 0) return errorResponse("job_id is required", 400);
    if (!description) return errorResponse("Enter a material description", 400);
    if (quantity <= 0) return errorResponse("Quantity must be greater than zero", 400);

    await ensureSchema(db);
    const invoiceFileId = source === "supplier_invoice" ? cleanText(body.invoice_file_id, 100) : "";
    if (source === "supplier_invoice" && invoiceFileId) {
      const file = await db.prepare(
        "SELECT id FROM job_files WHERE id = ? AND job_id = ? AND document_role = 'supplier_invoice'"
      ).bind(invoiceFileId, jobId).first();
      if (!file) return errorResponse("Choose a supplier invoice attached to this job", 400);
    }
    if (source === "supplier_invoice" && !invoiceFileId) {
      return errorResponse("Upload and select the supplier invoice first", 400);
    }

    const requestedId = cleanText(body.id, 100);
    const id = requestedId || crypto.randomUUID();
    const values = [
      source, source === "stock" ? "Solectrics stock" : cleanText(body.supplier_name, 200),
      source === "stock" ? null : cleanText(body.invoice_number, 100) || null,
      source === "stock" ? null : cleanText(body.invoice_date, 10) || null,
      invoiceFileId || null, description, cleanText(body.supplier_sku, 120) || null,
      quantity, cleanText(body.unit_code, 40) || null, unitCost
    ];
    if (requestedId) {
      const result = await db.prepare(`
        UPDATE job_materials
        SET source = ?, supplier_name = ?, invoice_number = ?, invoice_date = ?,
            invoice_file_id = ?, description = ?, supplier_sku = ?, quantity = ?,
            unit_code = ?, unit_cost_ex_gst = ?
        WHERE id = ? AND job_id = ?
      `).bind(...values, requestedId, jobId).run();
      if (!(result.meta?.changes > 0)) return errorResponse("Material item not found", 404);
    } else {
      await db.prepare(`
        INSERT INTO job_materials
          (id, job_id, source, supplier_name, invoice_number, invoice_date,
           invoice_file_id, description, supplier_sku, quantity, unit_code, unit_cost_ex_gst)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, jobId, ...values).run();
    }
    return Response.json({ ok: true, id, message: requestedId ? "Material updated" : "Material recorded" });
  } catch (error) {
    console.error("Job materials POST error:", error);
    return errorResponse("Unable to save material", 500, error.message);
  }
}

export async function onRequestDelete(context) {
  try {
    const db = context.env.DB;
    const url = new URL(context.request.url);
    const jobId = Number(url.searchParams.get("job_id"));
    const id = cleanText(url.searchParams.get("id"), 100);
    if (!db) return errorResponse("D1 database binding DB is not available");
    if (!Number.isInteger(jobId) || jobId <= 0 || !id) return errorResponse("job_id and id are required", 400);
    await ensureSchema(db);
    const result = await db.prepare("DELETE FROM job_materials WHERE id = ? AND job_id = ?").bind(id, jobId).run();
    if (!(result.meta?.changes > 0)) return errorResponse("Material item not found", 404);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Job materials DELETE error:", error);
    return errorResponse("Unable to remove material", 500, error.message);
  }
}
