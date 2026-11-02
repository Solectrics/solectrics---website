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

    if (!file.size) return json({error:"The bill file is empty."},400);

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
  "electricity_total_incl_gst_nzd": number|null,
  "broadband_total_incl_gst_nzd": number|null,
  "daily_fixed_charge_cents": number|null,
  "import_rate_cents": number|null,
  "import_rate_gst_basis": string|null,
  "daily_fixed_charge_gst_basis": string|null,
  "peak_rate_cents": number|null,
  "offpeak_rate_cents": number|null,
  "controlled_rate_cents": number|null,
  "ev_night_rate_cents": number|null,
  "export_rate_cents": number|null,
  "peak_export_rate_cents": number|null,
  "fixed_term": string|null,
  "exit_cost_nzd": number|null,
  "other_tariff_information": string|null,
  "gst_nzd": number|null,
  "icp": string|null,
  "notes": string|null,
  "needs_review_fields": string[],
  "confidence": number
}

Rules:
- Use consumed kWh, never cumulative meter register readings or dollar amounts.
- Rate fields are numeric cents/kWh exactly as printed; do not add GST.
- import_rate_gst_basis and daily_fixed_charge_gst_basis must be inclusive, exclusive or null. Unknown tax basis must be flagged for review.
- Convert dollars/day to cents/day by multiplying by 100.
- Do not subtract a previous balance or payment from current electricity charges.
- Dates refer to the consumption period, not payment due date.
- daily_fixed_charge_cents must be numeric cents/day.
- total_bill_nzd is the total amount payable across all services including GST, not electricity-only. Return null if unclear.
- electricity_total_incl_gst_nzd is the electricity portion only, including GST and electricity fixed charges, excluding broadband, phone, and other non-electricity services. Calculate only if the bill provides enough detail; otherwise null and mark for review.
- broadband_total_incl_gst_nzd is the broadband/phone portion including GST where shown or unambiguously calculable; otherwise null.
- gst_nzd is GST for the entire invoice if shown; do not add GST again to an inclusive total.
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
      console.error("Bill provider rejected request.");
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
      console.error("Bill response could not be structured.");
      return json({ error: "We read the bill but could not structure the result." }, 502);
    }

    return json(sanitise(parsed), 200);

  } catch (err) {
    console.error("Bill reading failed.");
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
    "total_bill_nzd","electricity_total_incl_gst_nzd","broadband_total_incl_gst_nzd","daily_fixed_charge_cents","import_rate_cents",
    "peak_rate_cents","offpeak_rate_cents","controlled_rate_cents",
    "ev_night_rate_cents","export_rate_cents","peak_export_rate_cents",
    "exit_cost_nzd","gst_nzd","confidence"
  ];
  const strings = [
    "retailer","plan_name","billing_period_start","billing_period_end","icp","notes",
    "fixed_term","other_tariff_information","import_rate_gst_basis","daily_fixed_charge_gst_basis"
  ];

  const out = {};
  for (const k of numeric) {
    const v = x?.[k];
    out[k] = (v === null || v === undefined || v === "")
      ? null
      : ((typeof v === "number" || (typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v.trim()))) && Number.isFinite(Number(v)) ? Number(v) : null);
  }
  for (const k of strings) {
    const v = x?.[k];
    out[k] = (v === null || v === undefined || v === "")
      ? null
      : String(v).slice(0, 500);
  }
  const allowedReviewFields = new Set([...numeric, ...strings].filter(k => k !== "confidence"));
  out.needs_review_fields = Array.isArray(x?.needs_review_fields)
    ? x.needs_review_fields.map(String).filter(k => allowedReviewFields.has(k)).slice(0, 30)
    : [];
  for(const key of ["import_rate_gst_basis","daily_fixed_charge_gst_basis"]){
    if(!["inclusive","exclusive"].includes(out[key])){out[key]=null;out.needs_review_fields.push(key);}
  }
  for(const key of numeric){if(out[key]!==null&&out[key]<0){out[key]=null;out.needs_review_fields.push(key);}}
  if(out.billing_days!==null&&(!Number.isInteger(out.billing_days)||out.billing_days>366)){out.needs_review_fields.push('billing_days');}
  const start=Date.parse(out.billing_period_start),end=Date.parse(out.billing_period_end);
  if(Number.isFinite(start)&&Number.isFinite(end)&&(end<start||(out.billing_days!==null&&Math.abs((end-start)/86400000+1-out.billing_days)>1))){out.needs_review_fields.push('billing_days','billing_period_start','billing_period_end');}
  if(out.electricity_total_incl_gst_nzd!==null&&out.broadband_total_incl_gst_nzd!==null&&out.total_bill_nzd!==null&&Math.abs(out.electricity_total_incl_gst_nzd+out.broadband_total_incl_gst_nzd-out.total_bill_nzd)>.05){out.needs_review_fields.push('electricity_total_incl_gst_nzd');}
  if(out.confidence!==null)out.confidence=Math.max(0,Math.min(1,out.confidence));
  out.needs_review_fields=[...new Set(out.needs_review_fields)];
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
