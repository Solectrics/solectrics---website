import { ensureJobFileRoleColumn } from "./_schema.js";

const MAX_FILE_SIZE = 12 * 1024 * 1024;

function errorResponse(message, status = 500, detail) {
  return Response.json({ ok: false, error: message, ...(detail ? { detail } : {}) }, { status });
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableMoney(value, maximum = 10000000) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= maximum ? parsed : null;
}

function positiveNumber(value, maximum = 1000000) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= maximum ? parsed : null;
}

function isoDate(value) {
  const text = cleanText(value, 40);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function sanitiseSupplierInvoice(raw) {
  const sourceLines = Array.isArray(raw?.lines) ? raw.lines : [];
  const warnings = [];
  const lines = sourceLines.slice(0, 300).map((line, index) => {
    const description = cleanText(line?.description, 1000);
    const quantity = positiveNumber(line?.quantity);
    const extension = nullableMoney(line?.extension_ex_gst);
    let unitPrice = nullableMoney(line?.unit_price_ex_gst);
    if (quantity && extension !== null && (
      unitPrice === null || Math.abs((quantity * unitPrice) - extension) > 0.02
    )) {
      unitPrice = Number((extension / quantity).toFixed(4));
    }
    if (!description || quantity === null || unitPrice === null || extension === null) return null;
    return {
      id: `invoice-line-${index + 1}`,
      stock_code: cleanText(line?.stock_code, 120) || null,
      description,
      quantity,
      unit: cleanText(line?.unit, 40) || "each",
      unit_price_ex_gst: unitPrice,
      extension_ex_gst: extension
    };
  }).filter(Boolean);

  if (!sourceLines.length) warnings.push("No product lines were found.");
  if (lines.length !== sourceLines.length) warnings.push("One or more incomplete lines were excluded from the preview.");

  const subtotal = nullableMoney(raw?.subtotal_ex_gst);
  const calculatedSubtotal = Number(lines.reduce((sum, line) => sum + line.extension_ex_gst, 0).toFixed(2));
  if (subtotal !== null && lines.length && Math.abs(subtotal - calculatedSubtotal) > 0.1) {
    warnings.push(`Extracted lines total $${calculatedSubtotal.toFixed(2)}, but the printed subtotal is $${subtotal.toFixed(2)}.`);
  }

  const rawConfidence = Number(raw?.confidence);
  return {
    supplier: cleanText(raw?.supplier, 200) || "J.A. Russell",
    document_type: raw?.document_type === "credit_note" ? "credit_note" : "invoice",
    invoice_number: cleanText(raw?.invoice_number, 100) || null,
    invoice_date: isoDate(raw?.invoice_date),
    purchase_order_reference: cleanText(raw?.purchase_order_reference, 200) || null,
    subtotal_ex_gst: subtotal,
    gst: nullableMoney(raw?.gst),
    total_incl_gst: nullableMoney(raw?.total_incl_gst),
    lines,
    calculated_subtotal_ex_gst: calculatedSubtotal,
    confidence: Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0,
    warnings
  };
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)));
  }
  return btoa(binary);
}

function getOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function getBucket(env) {
  return env.JOB_FILES || env.UPLOADS || env.BUCKET || null;
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    const bucket = getBucket(context.env);
    if (!db) return errorResponse("D1 database binding DB is not available");
    if (!bucket) return errorResponse("Job-file storage is not available", 503);
    if (!context.env.OPENAI_API_KEY) return errorResponse("Supplier invoice reading is not configured yet", 503);

    const body = await context.request.json();
    const jobId = Number(body.job_id);
    const fileId = cleanText(body.file_id, 100);
    if (!Number.isInteger(jobId) || jobId <= 0) return errorResponse("job_id is required", 400);
    if (!fileId) return errorResponse("Choose an uploaded supplier invoice", 400);

    await ensureJobFileRoleColumn(db);
    const file = await db.prepare(`
      SELECT id, job_id, storage_key, original_name, content_type, size_bytes, document_role
      FROM job_files WHERE id = ? AND job_id = ?
    `).bind(fileId, jobId).first();
    if (!file) return errorResponse("Supplier invoice file not found", 404);
    if (file.document_role !== "supplier_invoice") {
      return errorResponse("Choose a file uploaded as Supplier invoice", 400);
    }
    if (file.content_type !== "application/pdf" && !String(file.original_name).toLowerCase().endsWith(".pdf")) {
      return errorResponse("Invoice reading currently requires a PDF", 400);
    }
    if (Number(file.size_bytes) > MAX_FILE_SIZE) return errorResponse("Please use a PDF under 12 MB", 400);

    const object = await bucket.get(file.storage_key);
    if (!object) return errorResponse("Stored supplier invoice could not be opened", 404);
    const bytes = new Uint8Array(await object.arrayBuffer());

    const prompt = `
Read this New Zealand electrical supplier invoice or credit note and return only valid JSON.
Extract every priced product line from every page. Do not treat headings, freight summaries, GST rows or payment details as products unless freight is a separately priced line.
All monetary values must be numbers in NZ dollars. Line prices and subtotal are GST-exclusive.
unit_price_ex_gst must be the net unit cost after any line discount, so quantity multiplied by unit_price_ex_gst reconciles to extension_ex_gst.
For a credit note, return document_type as credit_note and monetary values as negative numbers.
Dates must be YYYY-MM-DD. Preserve the supplier's stock codes and printed quantities.

Return exactly this structure:
{
  "supplier": string|null,
  "document_type": "invoice"|"credit_note",
  "invoice_number": string|null,
  "invoice_date": string|null,
  "purchase_order_reference": string|null,
  "subtotal_ex_gst": number|null,
  "gst": number|null,
  "total_incl_gst": number|null,
  "lines": [{
    "stock_code": string|null,
    "description": string,
    "quantity": number,
    "unit": string|null,
    "unit_price_ex_gst": number|null,
    "extension_ex_gst": number
  }],
  "confidence": number
}

Check that the line extensions approximately reconcile to the printed subtotal. Do not invent missing products or prices. A person will review the preview before anything is saved.
`;

    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${context.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.6",
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            {
              type: "input_file",
              filename: cleanText(file.original_name, 255) || "supplier-invoice.pdf",
              file_data: `data:application/pdf;base64,${bytesToBase64(bytes)}`
            }
          ]
        }]
      })
    });
    const apiJson = await apiResponse.json();
    if (!apiResponse.ok) {
      console.error("Supplier invoice reader error:", apiJson);
      return errorResponse("The supplier invoice-reading service returned an error", 502);
    }

    const outputText = getOutputText(apiJson);
    if (!outputText) return errorResponse("The supplier invoice reader returned no data", 502);
    let parsed;
    try {
      parsed = JSON.parse(outputText.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim());
    } catch (error) {
      console.error("Could not parse supplier invoice result:", outputText);
      return errorResponse("The invoice was read but the result could not be structured", 502);
    }

    const invoice = sanitiseSupplierInvoice(parsed);
    if (!invoice.lines.length && invoice.subtotal_ex_gst === null) {
      return errorResponse("No invoice total or priced product lines were found", 422);
    }
    return Response.json({ ok: true, file_id: fileId, invoice });
  } catch (error) {
    console.error("Supplier invoice reading error:", error);
    return errorResponse("Unable to read supplier invoice", 500, error.message);
  }
}
