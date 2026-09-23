import { ensureJobFileRoleColumn } from "./_schema.js";

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const ASSIGNMENTS = new Set(["shared", "battery_now"]);

function errorResponse(message, status = 500, detail) {
  return Response.json({ ok: false, error: message, ...(detail ? { detail } : {}) }, { status });
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableNumber(value, maximum = 10000000) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null;
}

function isoDate(value) {
  const text = cleanText(value, 40);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function suggestedAssignment(description, modelSuggestion) {
  const text = String(description || "").toLowerCase();
  if (/\b(battery|batteries|gateway|backup|eps)\b/.test(text)) return "battery_now";
  return ASSIGNMENTS.has(modelSuggestion) ? modelSuggestion : "shared";
}

export function sanitiseFletcherQuote(raw) {
  const lines = Array.isArray(raw?.lines) ? raw.lines : [];
  const rawConfidence = Number(raw?.confidence);
  const cleanedLines = lines.slice(0, 200).map((line, index) => {
    const description = cleanText(line?.description, 1000);
    const quantity = nullableNumber(line?.quantity, 1000000);
    const unitPrice = nullableNumber(line?.unit_price_ex_gst);
    const extension = nullableNumber(line?.extension_ex_gst);
    if (!description || quantity === null || unitPrice === null || extension === null) return null;
    return {
      id: `import-${index + 1}`,
      stock_code: cleanText(line?.stock_code, 100) || null,
      description,
      quantity,
      unit: cleanText(line?.unit, 40) || "EA",
      unit_price_ex_gst: unitPrice,
      extension_ex_gst: extension,
      assignment: suggestedAssignment(description, line?.assignment)
    };
  }).filter(Boolean);

  const subtotal = nullableNumber(raw?.subtotal_ex_gst);
  const calculatedSubtotal = Number(cleanedLines.reduce(
    (sum, line) => sum + line.extension_ex_gst, 0
  ).toFixed(2));
  const warnings = [];
  if (!lines.length) warnings.push("No product lines were found.");
  if (cleanedLines.length !== lines.length) warnings.push("One or more incomplete lines were excluded from the preview.");
  if (subtotal !== null && Math.abs(subtotal - calculatedSubtotal) > 0.1) {
    warnings.push(`Extracted lines total $${calculatedSubtotal.toFixed(2)}, but the quote subtotal is $${subtotal.toFixed(2)}.`);
  }

  return {
    supplier: cleanText(raw?.supplier, 200) || "J.A. Russell",
    quote_number: cleanText(raw?.quote_number, 100) || null,
    project: cleanText(raw?.project, 200) || null,
    quote_date: isoDate(raw?.quote_date),
    valid_until: isoDate(raw?.valid_until),
    subtotal_ex_gst: subtotal,
    gst: nullableNumber(raw?.gst),
    total_incl_gst: nullableNumber(raw?.total_incl_gst),
    exclusions: (Array.isArray(raw?.exclusions) ? raw.exclusions : [])
      .map(value => cleanText(value, 500)).filter(Boolean).slice(0, 30),
    lines: cleanedLines,
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
    if (!context.env.OPENAI_API_KEY) return errorResponse("Fletcher quote reading is not configured yet", 503);

    const body = await context.request.json();
    const jobId = Number(body.job_id);
    const fileId = cleanText(body.file_id, 100);
    if (!Number.isInteger(jobId) || jobId <= 0) return errorResponse("job_id is required", 400);
    if (!fileId) return errorResponse("Choose a supplier quote", 400);

    await ensureJobFileRoleColumn(db);
    const file = await db.prepare(`
      SELECT id, job_id, storage_key, original_name, content_type, size_bytes, document_role
      FROM job_files WHERE id = ? AND job_id = ?
    `).bind(fileId, jobId).first();
    if (!file) return errorResponse("Supplier quote file not found", 404);
    if (file.document_role !== "supplier_quote") return errorResponse("Choose a file uploaded as Supplier quote", 400);
    if (file.content_type !== "application/pdf" && !String(file.original_name).toLowerCase().endsWith(".pdf")) {
      return errorResponse("Fletcher quote import currently requires a PDF", 400);
    }
    if (Number(file.size_bytes) > MAX_FILE_SIZE) return errorResponse("Please use a PDF under 12 MB", 400);

    const object = await bucket.get(file.storage_key);
    if (!object) return errorResponse("Stored supplier quote could not be opened", 404);
    const bytes = new Uint8Array(await object.arrayBuffer());

    const prompt = `
Read this J.A. Russell / Fletcher solar supplier quotation and return only valid JSON.
Extract every priced product line from every page. Do not treat headings, notes or exclusions as products.
All monetary values must be numbers in NZ dollars. Supplier prices are GST-exclusive.
Dates must be YYYY-MM-DD.

Return exactly this structure:
{
  "supplier": "J.A. Russell",
  "quote_number": string|null,
  "project": string|null,
  "quote_date": string|null,
  "valid_until": string|null,
  "subtotal_ex_gst": number|null,
  "gst": number|null,
  "total_incl_gst": number|null,
  "exclusions": [string],
  "lines": [{
    "stock_code": string|null,
    "description": string,
    "quantity": number,
    "unit": string|null,
    "unit_price_ex_gst": number,
    "extension_ex_gst": number,
    "assignment": "shared"|"battery_now"
  }],
  "confidence": number
}

Assignment rules:
- battery modules, battery-only accessories, gateway, backup and EPS equipment: battery_now
- panels, hybrid energy controller/inverter, meter, mounting and ordinary solar materials: shared
- when uncertain, use shared; a person will review before import

Check that the line extensions approximately reconcile to the printed subtotal. Do not invent missing products or prices.
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
              filename: cleanText(file.original_name, 255) || "fletcher-quote.pdf",
              file_data: `data:application/pdf;base64,${bytesToBase64(bytes)}`
            }
          ]
        }]
      })
    });
    const apiJson = await apiResponse.json();
    if (!apiResponse.ok) {
      console.error("Fletcher quote reader error:", apiJson);
      return errorResponse("The Fletcher quote-reading service returned an error", 502);
    }

    const outputText = getOutputText(apiJson);
    if (!outputText) return errorResponse("The Fletcher quote reader returned no data", 502);
    let parsed;
    try {
      parsed = JSON.parse(outputText.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim());
    } catch (error) {
      console.error("Could not parse Fletcher quote result:", outputText);
      return errorResponse("The quote was read but the result could not be structured", 502);
    }

    const quote = sanitiseFletcherQuote(parsed);
    if (!quote.lines.length) return errorResponse("No priced product lines were found in this quote", 422);
    return Response.json({ ok: true, file_id: fileId, quote });
  } catch (error) {
    console.error("Fletcher quote import error:", error);
    return errorResponse("Unable to read Fletcher quote", 500, error.message);
  }
}
