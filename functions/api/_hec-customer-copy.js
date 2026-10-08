const ANSWER_FIELDS = [
  ["name", "Name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["address", "Property address"],
  ["people", "People in the home"],
  ["householdPersona", "Household type"],
  ["homeType", "Home type"],
  ["loads", "Appliances and energy uses"],
  ["evDayHome", "Electric vehicle use"],
  ["roof", "Roof"],
  ["direction", "Roof direction"],
  ["shade", "Shading"],
  ["existingSolar", "Existing solar"],
  ["batteryInterest", "Battery interest"],
  ["hotWater", "Hot water"],
  ["cylinderSize", "Hot water cylinder size"],
  ["hotWaterControl", "Hot water control"],
  ["cylinderCondition", "Hot water cylinder condition"],
  ["dayHome", "Daytime occupancy"],
  ["workFromHome", "Working from home"],
  ["loadTiming", "Energy use timing"],
  ["goals", "What matters to you"],
  ["plannedChanges", "Planned changes"]
];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function displayValue(value) {
  if (Array.isArray(value)) return value.filter(item => item != null && item !== "").map(String).join(", ");
  if (value && typeof value === "object") return "";
  if (value == null || value === "") return "";
  return String(value);
}

export function renderHomeEnergyCheckCopy(answers = {}) {
  const rows = ANSWER_FIELDS
    .map(([key, label]) => [label, displayValue(answers[key])])
    .filter(([, value]) => value)
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");

  const uploadedFiles = [
    ...(answers.energyDataUploads?.recentBills || []),
    ...(answers.energyDataUploads?.annualUsage || [])
  ].map(file => typeof file === "string" ? file : file?.name)
    .filter(Boolean)
    .map(name => `<li>${escapeHtml(name)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Home Energy Check</title>
<style>body{font-family:Arial,sans-serif;color:#24342f;line-height:1.5;margin:0;background:#f7f5ef}main{max-width:720px;margin:24px auto;padding:28px;background:#fff;border-radius:12px}h1{font-size:24px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #dddcd6;vertical-align:top}th{width:36%;color:#68736f}p{color:#68736f}</style></head>
<body><main><h1>Your completed Home Energy Check</h1>
<p>This is the copy you asked Solectrics to email you. It contains the answers you supplied in the Home Energy Check.</p>
<table><tbody>${rows}</tbody></table>
${uploadedFiles ? `<h2>Electricity information files</h2><p>These file names were included with your submission:</p><ul>${uploadedFiles}</ul>` : ""}
<p>Thank you,<br>Solectrics</p></main></body></html>`;
}

export async function sendHomeEnergyCheckCopy(env, answers, recipient = answers?.email) {
  if (!env?.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
  if (!recipient || !String(recipient).includes("@")) throw new Error("Customer email address is missing or invalid");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.HEC_FROM_EMAIL || env.FLETCHER_FROM_EMAIL || "Solectrics Job Hub <mini-fergus@solectrics.co.nz>",
      to: [recipient],
      subject: "Your completed Home Energy Check",
      html: renderHomeEnergyCheckCopy(answers)
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Customer copy email failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  return true;
}

