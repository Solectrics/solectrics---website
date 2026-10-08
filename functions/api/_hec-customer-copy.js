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

const SOLECTRICS_LOGO_URL = "https://www.solectrics.co.nz/EFEC3451-B808-452A-8EA2-64B22E36C363.png";
const DEFAULT_HEC_FROM = "Jane at Solectrics <jane@solectrics.co.nz>";

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

function answerRows(answers) {
  return ANSWER_FIELDS
    .map(([key, label]) => [label, displayValue(answers[key])])
    .filter(([, value]) => value)
    .map(([label, value]) => `
      <tr>
        <td style="padding:0 0 18px 0;border-bottom:1px solid #ead9bd;">
          <div style="padding-top:16px;color:#3c876c;font-size:11px;line-height:1.3;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${escapeHtml(label)}</div>
          <div style="padding-top:5px;color:#17332d;font-size:16px;line-height:1.5;">${escapeHtml(value)}</div>
        </td>
      </tr>`)
    .join("");
}

function uploadedFileRows(answers) {
  return [
    ...(answers.energyDataUploads?.recentBills || []),
    ...(answers.energyDataUploads?.annualUsage || [])
  ].map(file => typeof file === "string" ? file : file?.name)
    .filter(Boolean)
    .map(name => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #ead9bd;color:#17332d;font-size:15px;line-height:1.45;">${escapeHtml(name)}</td>
      </tr>`)
    .join("");
}

export function renderHomeEnergyCheckCopy(answers = {}) {
  const rows = answerRows(answers);
  const uploadedFiles = uploadedFileRows(answers);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your completed Home Energy Check</title>
</head>
<body style="margin:0;padding:0;background:#f7f4ed;color:#17332d;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f7f4ed;border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border-collapse:separate;border-spacing:0;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:26px 28px 18px 28px;border-bottom:4px solid #ef9c20;">
              <img src="${SOLECTRICS_LOGO_URL}" width="176" alt="Solectrics" style="display:block;width:176px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">
            </td>
          </tr>
          <tr>
            <td style="padding:30px 28px 8px 28px;">
              <div style="color:#ef9c20;font-size:12px;line-height:1.3;font-weight:700;letter-spacing:.10em;text-transform:uppercase;">Your home · your energy</div>
              <h1 style="margin:8px 0 14px 0;color:#17332d;font-size:28px;line-height:1.15;font-weight:700;">Your completed Home Energy Check</h1>
              <p style="margin:0;color:#61716c;font-size:16px;line-height:1.6;">Thank you for taking the time to complete your Home Energy Check. Here is a copy of the information you shared with us.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 10px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
                ${rows}
              </table>
            </td>
          </tr>
          ${uploadedFiles ? `
          <tr>
            <td style="padding:18px 28px 4px 28px;">
              <h2 style="margin:0;color:#17332d;font-size:19px;line-height:1.3;">Electricity information you supplied</h2>
              <p style="margin:6px 0 0 0;color:#61716c;font-size:14px;line-height:1.5;">These are the file names included with your Home Energy Check.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 28px 16px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
                ${uploadedFiles}
              </table>
            </td>
          </tr>` : ""}
          <tr>
            <td style="padding:24px 28px;background:#f7f4ed;border-top:4px solid #ef9c20;">
              <h2 style="margin:0 0 8px 0;color:#3c876c;font-size:19px;line-height:1.3;">What happens next?</h2>
              <p style="margin:0;color:#40554f;font-size:15px;line-height:1.6;">We’ll review what you’ve shared and use it as the starting point for understanding your home, how you use energy and which options may suit you best.</p>
              <p style="margin:18px 0 0 0;color:#17332d;font-size:15px;line-height:1.5;">Warmly,<br><strong>Jane, Solectrics</strong></p>
            </td>
          </tr>
        </table>
        <div style="max-width:640px;padding:14px 8px 0 8px;color:#7a817d;font-size:11px;line-height:1.45;text-align:center;">Solectrics · Waiheke Island, New Zealand</div>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
      from: env.HEC_FROM_EMAIL || DEFAULT_HEC_FROM,
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
