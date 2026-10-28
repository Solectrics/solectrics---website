// Cloudflare Pages Function
// Path: functions/api/read-bill.js
//
// Required Cloudflare secret:
// OPENAI_API_KEY
//
// IMPORTANT:
// Never put the API key in HTML or commit it to GitHub.
// Redeploy after adding OPENAI_API_KEY secret
export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if (!env.OPENAI_API_KEY) {
      return json({ error: "Bill reader is not configured yet." }, 500);
    }

    const form = await request.formData();
    const file = form.get("bill");

    if (!(file instanceof File)) {
      return json({ error: "No bill file received." }, 400);
    }

    if (file.size > 12 * 1024 * 1024) {
      return json({ error: "Please upload a file smaller than 12 MB." }, 400);
    }

    const mime = file.type || "application/octet-stream";
    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64 = bytesToBase64(bytes);

    let filePart;
    if (mime.startsWith("image/")) {
      filePart = {
        type: "input_image",
        image_url: `data:${mime};base64,${base64}`,
        detail: "high"
      };
    } else if (mime === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      filePart = {
        type: "input_file",
        filename: file.name || "electricity-bill.pdf",
        file_data: `data:application/pdf;base64,${base64}`
      };
    } else {
      return json({ error: "Please upload a PDF or image file." }, 400);
    }

    const prompt = `
Extract structured information from this New Zealand residential electricity bill.

Only return values actually visible or clearly inferable.
Use null when a value is not shown.
Do NOT return customer name, street address, email, phone, bank details or account number.
ICP may be returned because it is useful for electricity connection identification.

Return ONLY valid JSON with exactly these keys:
{
  "retailer": string|null,
  "plan_name": string|null,
  "billing_period_start": string|null,
  "billing_period_end": string|null,
  "billing_days": number|null,
  "total_import_kwh": number|null,
  "average_daily_kwh": number|null,
  "total_export_kwh": number|null,
  "total_bill_nzd": number|null,
  "electricity_charges_nzd": number|null,
  "non_electricity_charges_nzd": number|null,
  "electricity_cost_separation_status": string|null,
  "charged_import_kwh": number|null,
  "free_import_kwh": number|null,
  "free_import_schedule": string|null,
  "daily_fixed_charge_cents": number|null,
  "daily_fixed_charge_gst_basis": string|null,
  "import_rate_cents": number|null,
  "import_rate_gst_basis": string|null,
  "peak_rate_cents": number|null,
  "offpeak_rate_cents": number|null,
  "controlled_rate_cents": number|null,
  "ev_night_rate_cents": number|null,
  "export_rate_cents": number|null,
  "peak_export_rate_cents": number|null,
  "fixed_term": string|null,
  "exit_cost_nzd": number|null,
  "other_tariff_information": string|null,
  "tariff_description": string|null,
  "gst_nzd": number|null,
  "electricity_gst_nzd": number|null,
  "icp": string|null,
  "notes": string|null,
  "needs_review_fields": string[],
  "confidence": number
}

Rules:
- Rate fields must be numeric cents/kWh exactly as printed on the bill; do not add or remove GST.
- daily_fixed_charge_cents must be numeric cents/day exactly as printed.
- import_rate_gst_basis and daily_fixed_charge_gst_basis must be "exclusive", "inclusive", or null according to the bill.
- total_bill_nzd is the WHOLE invoice total including GST, including any bundled non-electricity services.
- electricity_charges_nzd is only the electricity portion of the invoice, including GST.
- non_electricity_charges_nzd is the total of separately identifiable non-electricity services, including GST.
- electricity_cost_separation_status must be "electricity_only", "separated", or "needs_review".
- If the invoice includes another service and its electricity portion cannot be separated reliably, set electricity_charges_nzd to null, electricity_cost_separation_status to "needs_review", and include electricity_charges_nzd in needs_review_fields.
- gst_nzd is whole-invoice GST. electricity_gst_nzd is GST attributable to electricity only when clearly shown or exactly derivable from an explicitly separated electricity subtotal.
- If imported electricity includes charged and zero-price/free kWh, keep total_import_kwh as the full imported amount and populate charged_import_kwh and free_import_kwh. They should sum to total_import_kwh when all are clear.
- Record a visible free-electricity time window in free_import_schedule. Do not infer interval consumption inside that window.
- tariff_description may describe the confirmed tariff structure (for example low-user and free-period terms). plan_name must remain null unless an exact product/plan name is explicitly shown.
- total_bill_nzd, electricity_charges_nzd, non_electricity_charges_nzd, gst_nzd and electricity_gst_nzd must be numeric NZ dollars.
- Dates should be YYYY-MM-DD if clear, otherwise copy the visible date text.
- confidence must be 0 to 1.
- If a field is unclear, return null for that field and include its exact key in needs_review_fields.
- If multiple import rates exist and no single main rate is obvious, use peak/offpeak/controlled fields and leave import_rate_cents null.
`;

    const payload = {
      model: "gpt-5.6",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          filePart
        ]
      }]
    };

    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const apiJson = await apiResponse.json();

    if (!apiResponse.ok) {
      console.error(apiJson);
      return json({ error: "The bill-reading service returned an error." }, 502);
    }

    const outputText = getOutputText(apiJson);
    if (!outputText) {
      return json({ error: "The bill reader returned no data." }, 502);
    }

    let parsed;
    try {
      parsed = JSON.parse(
        outputText.trim()
          .replace(/^```json\s*/i, "")
          .replace(/```$/i, "")
          .trim()
      );
    } catch (e) {
      console.error("Could not parse:", outputText);
      return json({ error: "We read the bill but could not structure the result." }, 502);
    }

    return json(sanitise(parsed), 200);

  } catch (err) {
    console.error(err);
    return json({ error: "Unexpected bill-reading error." }, 500);
  }
}

function getOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  for (const item of response.output || []) {
    if (item.type === "message") {
      for (const c of item.content || []) {
        if (c.type === "output_text" && typeof c.text === "string") {
          return c.text;
        }
      }
    }
  }
  return "";
}

export function sanitise(x) {
  const numeric = [
    "billing_days","total_import_kwh","average_daily_kwh","total_export_kwh",
    "total_bill_nzd","electricity_charges_nzd","non_electricity_charges_nzd",
    "charged_import_kwh","free_import_kwh","daily_fixed_charge_cents","import_rate_cents",
    "peak_rate_cents","offpeak_rate_cents","controlled_rate_cents",
    "ev_night_rate_cents","export_rate_cents","peak_export_rate_cents",
    "exit_cost_nzd","gst_nzd","electricity_gst_nzd","confidence"
  ];
  const strings = [
    "retailer","plan_name","billing_period_start","billing_period_end","icp","notes",
    "fixed_term","other_tariff_information","tariff_description","free_import_schedule",
    "electricity_cost_separation_status","daily_fixed_charge_gst_basis","import_rate_gst_basis"
  ];

  const out = {};
  for (const k of numeric) {
    const v = x?.[k];
    out[k] = (v === null || v === undefined || v === "")
      ? null
      : (Number.isFinite(Number(v)) ? Number(v) : null);
  }
  for (const k of strings) {
    const v = x?.[k];
    out[k] = (v === null || v === undefined || v === "")
      ? null
      : String(v).slice(0, 500);
  }
  if (!["electricity_only","separated","needs_review"].includes(out.electricity_cost_separation_status)) {
    out.electricity_cost_separation_status = null;
  }
  for (const key of ["daily_fixed_charge_gst_basis","import_rate_gst_basis"]) {
    if (!["exclusive","inclusive"].includes(out[key])) out[key] = null;
  }

  if (out.total_import_kwh !== null && out.charged_import_kwh !== null && out.free_import_kwh !== null) {
    const split = out.charged_import_kwh + out.free_import_kwh;
    if (Math.abs(split - out.total_import_kwh) > 0.05) {
      out.charged_import_kwh = null;
      out.free_import_kwh = null;
      x = { ...x, needs_review_fields: [...(Array.isArray(x?.needs_review_fields) ? x.needs_review_fields : []), "charged_import_kwh", "free_import_kwh"] };
    }
  }

  const allowedReviewFields = new Set([...numeric, ...strings].filter(k => k !== "confidence"));
  out.needs_review_fields = Array.isArray(x?.needs_review_fields)
    ? x.needs_review_fields.map(String).filter(k => allowedReviewFields.has(k)).slice(0, 30)
    : [];
  for (const k of out.needs_review_fields) out[k] = null;
  return out;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
