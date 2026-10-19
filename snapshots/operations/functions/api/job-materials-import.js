function errorResponse(message, status = 500, detail) {
  return Response.json({ ok: false, error: message, ...(detail ? { detail } : {}) }, { status });
}

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

function cleanText(value, limit = 500) {
  return String(value ?? "").trim().slice(0, limit);
}

function positiveNumber(value, maximum = 1000000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= maximum ? parsed : null;
}

function money(value, maximum = 10000000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= maximum ? parsed : null;
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) return errorResponse("D1 database binding DB is not available");
    const body = await context.request.json();
    const jobId = Number(body.job_id);
    const fileId = cleanText(body.invoice_file_id, 100);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!Number.isInteger(jobId) || jobId <= 0) return errorResponse("job_id is required", 400);
    if (!fileId) return errorResponse("Choose an uploaded supplier invoice", 400);
    if (!items.length || items.length > 300) return errorResponse("Choose between 1 and 300 material lines", 400);

    await db.prepare(CREATE_TABLE).run();
    const file = await db.prepare(
      "SELECT id FROM job_files WHERE id = ? AND job_id = ? AND document_role = 'supplier_invoice'"
    ).bind(fileId, jobId).first();
    if (!file) return errorResponse("Choose a supplier invoice attached to this job", 400);
    const existing = await db.prepare(
      "SELECT id FROM job_materials WHERE job_id = ? AND invoice_file_id = ? LIMIT 1"
    ).bind(jobId, fileId).first();
    if (existing) return errorResponse("This invoice already has recorded material entries", 409);

    const supplier = cleanText(body.supplier_name, 200) || "J.A. Russell";
    const invoiceNumber = cleanText(body.invoice_number, 100) || null;
    const invoiceDate = /^\d{4}-\d{2}-\d{2}$/.test(cleanText(body.invoice_date, 10))
      ? cleanText(body.invoice_date, 10) : null;
    const cleaned = items.map((item, index) => {
      const description = cleanText(item?.description, 1000);
      const quantity = positiveNumber(item?.quantity);
      const unitCost = money(item?.unit_cost_ex_gst);
      if (!description || quantity === null || unitCost === null) return null;
      return {
        id: crypto.randomUUID(), description, quantity, unitCost,
        sku: cleanText(item?.supplier_sku, 120) || null,
        unit: cleanText(item?.unit_code, 40) || null,
        index
      };
    });
    const invalid = cleaned.findIndex(item => item === null);
    if (invalid >= 0) return errorResponse(`Check material line ${invalid + 1}`, 400);

    const statements = cleaned.map(item => db.prepare(`
      INSERT INTO job_materials
        (id, job_id, source, supplier_name, invoice_number, invoice_date,
         invoice_file_id, description, supplier_sku, quantity, unit_code, unit_cost_ex_gst)
      VALUES (?, ?, 'supplier_invoice', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      item.id, jobId, supplier, invoiceNumber, invoiceDate, fileId,
      item.description, item.sku, item.quantity, item.unit, item.unitCost
    ));
    await db.batch(statements);
    return Response.json({ ok: true, count: cleaned.length, message: "Invoice material lines recorded" });
  } catch (error) {
    console.error("Job material invoice import error:", error);
    return errorResponse("Unable to import invoice material lines", 500, error.message);
  }
}
