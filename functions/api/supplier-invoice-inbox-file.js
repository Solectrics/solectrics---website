function getBucket(env) { return env.JOB_FILES || env.UPLOADS || env.BUCKET || null; }
function fail(message, status = 404) { return Response.json({ ok: false, error: message }, { status }); }

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    const bucket = getBucket(context.env);
    if (!db) return fail("D1 database binding DB is not available", 500);
    if (!bucket) return fail("Job-file storage is not available", 503);
    const url = new URL(context.request.url);
    const id = String(url.searchParams.get("id") || "").trim();
    const bookId = String(url.searchParams.get("book_id") || "").trim();
    if (!id || !bookId) return fail("Invoice and book are required", 400);
    const row = await db.prepare(`SELECT storage_key, attachment_name, content_type
      FROM bookkeeping_supplier_invoice_inbox WHERE id = ? AND book_id = ?`).bind(id, bookId).first();
    if (!row) return fail("Supplier invoice not found");
    const object = await bucket.get(row.storage_key);
    if (!object) return fail("Stored supplier invoice PDF is unavailable", 404);
    const filename = encodeURIComponent(String(row.attachment_name || "supplier-invoice.pdf")).replace(/%20/g, "%20");
    const headers = {
      "content-type": row.content_type || "application/pdf",
      "content-disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    };
    if (Number.isFinite(object.size)) headers["content-length"] = String(object.size);
    return new Response(object.body, { headers });
  } catch (error) {
    console.error("Supplier invoice file GET error:", error);
    return fail("Unable to open supplier invoice", 500);
  }
}
