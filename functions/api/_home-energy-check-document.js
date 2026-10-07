const ANSWER_FIELDS = [
  ["name", "Name"], ["email", "Email"], ["phone", "Phone"], ["address", "Property address"],
  ["householdPersona", "Household type"], ["people", "People in the home"],
  ["dayHome", "Daytime occupancy"], ["workFromHome", "Work from home"], ["loadTiming", "When electricity use is highest"],
  ["hotWater", "Hot water"], ["cylinderSize", "Cylinder size"], ["hotWaterControl", "Controlled or ripple power"],
  ["cylinderCondition", "Cylinder condition"], ["loads", "Major electricity loads"], ["evDayHome", "EV at home during solar hours"],
  ["goals", "What you want solar to do"], ["existingSolar", "Existing solar"], ["batteryInterest", "Battery preference"],
  ["plannedChanges", "Planned changes"], ["roof", "Roof type"], ["direction", "Main roof direction"], ["shade", "Shading"]
];

const BILL_FIELDS = [
  ["retailer", "Retailer"], ["plan_name", "Plan / tariff name"], ["billing_period_start", "Billing period start"],
  ["billing_period_end", "Billing period end"], ["billing_days", "Billing days"], ["total_import_kwh", "Electricity imported (kWh)"],
  ["average_daily_kwh", "Average daily use (kWh)"], ["total_export_kwh", "Solar exported (kWh)"], ["total_bill_nzd", "Total bill ($)"],
  ["daily_fixed_charge_cents", "Daily fixed charge (c/day)"], ["import_rate_cents", "Main import rate (c/kWh)"],
  ["peak_rate_cents", "Peak rate (c/kWh)"], ["offpeak_rate_cents", "Off-peak rate (c/kWh)"],
  ["controlled_rate_cents", "Controlled / hot-water rate (c/kWh)"], ["ev_night_rate_cents", "EV / night rate (c/kWh)"],
  ["export_rate_cents", "Solar export credit (c/kWh)"], ["peak_export_rate_cents", "Peak solar export credit (c/kWh)"],
  ["fixed_term", "Fixed-term plan"], ["exit_cost_nzd", "Known exit / switching cost ($)"],
  ["other_tariff_information", "Other tariff information"], ["gst_nzd", "GST ($)"], ["icp", "ICP"],
  ["property_address", "Supply address shown on bill"]
];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function display(value) {
  if (Array.isArray(value)) return value.map(item => String(item)).join(", ");
  if (value && typeof value === "object") return "";
  return String(value ?? "").trim();
}

export function buildHomeEnergyCheckSections(answers = {}) {
  const sections = [];
  const addSection = (title, entries) => {
    const rows = entries.filter(([, value]) => display(value));
    if (rows.length) sections.push({ title, entries: rows });
  };
  addSection("Contact and property", ANSWER_FIELDS.slice(0, 4).map(([key, label]) => [label, answers[key]]));
  addSection("Home and energy use", ANSWER_FIELDS.slice(4).map(([key, label]) => [label, answers[key]]));
  for (const [season, title] of [["summer", "Summer electricity bill"], ["winter", "Winter electricity bill"]]) {
    const bill = answers.bills?.[season];
    if (bill && typeof bill === "object") {
      addSection(title, BILL_FIELDS.map(([key, label]) => [label, bill[key]]));
    }
  }
  return sections;
}

export function renderHomeEnergyCheckDocument(answers = {}, options = {}) {
  const sections = buildHomeEnergyCheckSections(answers);
  const title = "Your completed Solectrics Home Energy Check";
  const sectionsHtml = sections.map(section => `
    <section><h2>${escapeHtml(section.title)}</h2><dl>${section.entries.map(([label, value]) =>
      `<div class="row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(display(value))}</dd></div>`
    ).join("")}</dl></section>`).join("");
  const autoPrint = options.autoPrint ? "<script>window.addEventListener('load',()=>window.print())</script>" : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
    body{font:16px Arial,sans-serif;color:#263a36;background:#f7f5ef;margin:0;padding:28px}.sheet{max-width:820px;margin:auto;background:#fff;padding:32px;border-radius:14px}h1{font-size:28px;color:#173f3f}h2{font-size:18px;margin:24px 0 8px;color:#173f3f}p{line-height:1.5}.row{display:grid;grid-template-columns:minmax(180px,1fr) 2fr;gap:15px;border-top:1px solid #e6e1d8;padding:9px 0}dt{color:#68746f}dd{margin:0;overflow-wrap:anywhere}.actions{margin-bottom:18px}button{background:#173f3f;border:0;border-radius:5px;color:#fff;padding:11px 15px;font-weight:bold;cursor:pointer}@media print{body{padding:0;background:#fff}.sheet{padding:0;max-width:none}.actions{display:none}section{break-inside:avoid}}
    </style></head><body><main class="sheet"><div class="actions"><button onclick="window.print()">PRINT / SAVE AS PDF</button></div><h1>${title}</h1><p>This is a customer-facing copy of the information you provided to Solectrics. It does not include internal Job Hub notes or costing.</p>${sectionsHtml || "<p>No Home Energy Check answers were recorded.</p>"}</main>${autoPrint}</body></html>`;
}

export async function sendHomeEnergyCheckEmail(env, answers, recipient) {
  if (!env.RESEND_API_KEY) throw new Error("Customer email is not configured (RESEND_API_KEY is missing)");
  const to = String(recipient || answers.email || "").trim();
  if (!to) throw new Error("The customer email address is missing");
  const html = renderHomeEnergyCheckDocument(answers);
  const text = buildHomeEnergyCheckSections(answers).map(section =>
    `${section.title}\n${section.entries.map(([label, value]) => `${label}: ${display(value)}`).join("\n")}`
  ).join("\n\n");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.HEC_FROM_EMAIL || "Solectrics Job Hub <mini-fergus@solectrics.co.nz>",
      to: [to],
      subject: "Your completed Solectrics Home Energy Check",
      html,
      text
    })
  });
  if (!response.ok) throw new Error("Email service did not accept the Home Energy Check email");
  return true;
}
