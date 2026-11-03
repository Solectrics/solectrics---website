export const ANSWER_FIELDS = [
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
  ["roofCondition", "Roof condition"],
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

function hecEmailHighlights(answers) {
  const items=[];
  const goals=Array.isArray(answers.goals)?answers.goals.join(" ").toLowerCase():"";
  const loads=Array.isArray(answers.loads)?answers.loads.map(x=>String(x).toLowerCase()):[];
  const hotWater=String(answers.hotWater||"").toLowerCase();
  const direction=String(answers.direction||"").trim();
  const shade=String(answers.shade||"").trim();
  if(direction && shade) items.push("Your "+direction.toLowerCase()+"-facing roof and "+shade.toLowerCase()+" shading will need a roof and site check before we can recommend a solar layout.");
  if(hotWater.includes("electric hot-water"))items.push("Electric hot water may offer a useful opportunity for daytime solar timing, subject to your current tariff and any ripple control.");
  else if(hotWater.includes("heat-pump"))items.push("Your heat-pump hot water system may be suitable for solar-aware scheduling, depending on its controls.");
  if(loads.some(x=>x==="ev"))items.push("An EV may offer a valuable way to use surplus solar when the vehicle is at home during daylight hours.");
  if(loads.some(x=>/pool|spa|water pump/.test(x)))items.push("Pumps, pool or spa loads may offer opportunities for smarter scheduling.");
  if(goals.includes("backup")||goals.includes("outage")||String(answers.batteryInterest||"").toLowerCase().includes("backup"))items.push("Because backup matters to you, we'll review essential circuits, inverter capacity, gateway options and battery reserve before recommending a system.");
  else if(goals.includes("battery")||String(answers.batteryInterest||"").toLowerCase().includes("battery"))items.push("Battery storage may help use available surplus solar later, but winter charging and financial value need a closer assessment.");
  if(goals.includes("lower")||goals.includes("bill"))items.push("We can assess how solar, tariff choices and load-shifting could affect your bills after reviewing electricity-only charges and seasonal use.");
  if(!items.length)items.push("Your responses give us a useful starting point for considering solar, smarter energy use and whether storage would suit your home.");
  return items.slice(0,5);
}

export function renderHomeEnergyCheckCopy(answers={}) {
  const name=String(answers.name||"").trim();
  const greeting=name?"Hi "+escapeHtml(name.split(/\s+/)[0])+",":"Hello,";
  const highlights=hecEmailHighlights(answers).map(x=>'<li style="margin:0 0 12px;line-height:1.55;color:#17332d;">'+escapeHtml(x)+'</li>').join("");
  const priorities=Array.isArray(answers.goals)?answers.goals.filter(x=>typeof x==="string"&&x.trim()).slice(0,5):[];
  const prioritiesHtml=priorities.length?'<p style="color:#53665f;font-size:14px;font-weight:700;margin:8px 0;">Your priorities</p><ul style="margin:0 0 22px;padding-left:22px;">'+priorities.map(x=>'<li style="margin:0 0 7px;color:#17332d;">'+escapeHtml(x)+'</li>').join("")+'</ul>':"";
  const uploadedBillCount=Number.isSafeInteger(answers.uploadedBillCount)?Math.max(0,Math.min(2,answers.uploadedBillCount)):0;
  const evidenceNote=uploadedBillCount
   ? "You've supplied "+uploadedBillCount+" seasonal electricity bill"+(uploadedBillCount===1?"":"s")+". We'll review the bill information and tariffs before preparing a bespoke savings comparison."
   : "No electricity bills were supplied with this check. These are preliminary ideas based on your answers, not a prediction of your annual electricity costs or savings.";
  const nextText=answers.emailOnly
    ? "This copy is for you. No Solectrics enquiry was created by this email."
    : "Your Home Energy Check has been sent to Solectrics. We'll review what you've shared and contact you about useful next steps.";
  const bookingUrl=(typeof answers.visitBookingUrl==="string"&&/^https:\/\/(?:www\.)?solectrics\.co\.nz\/free-home-solar-visit\.html\?token=/.test(answers.visitBookingUrl))
    ? answers.visitBookingUrl
    : "mailto:jane@solectrics.co.nz?subject=Book%20my%20free%20home%20solar%20visit";
  const bookingNote=answers.visitBookingUrl
    ? "The button opens a short confirmation page for your existing enquiry — there's no need to repeat your Home Energy Check. We'll contact you to agree a visit time."
    : "The button opens an email draft to Solectrics. Send it to request a convenient visit time.";
  const rows=answerRows(answers);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Solectrics Home Energy Check</title></head>
<body style="margin:0;padding:0;background:#f7f4ed;color:#17332d;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ed;width:100%;border-collapse:collapse;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border-collapse:separate;border-spacing:0;border-radius:16px;overflow:hidden;">
<tr><td style="padding:23px 28px 18px;border-bottom:4px solid #ef9c20;">
<img src="${SOLECTRICS_LOGO_URL}" alt="Solectrics" width="160" style="display:block;width:160px;max-width:100%;height:auto;border:0;"></td></tr>
<tr><td style="padding:28px 28px 12px;">
<p style="font-size:12px;font-weight:800;letter-spacing:.1em;color:#ef9c20;margin:0;">YOUR HOME · YOUR ENERGY</p>
<h1 style="font-size:27px;line-height:1.2;color:#17332d;margin:9px 0 16px;">Your Home Energy Check</h1>
<p style="font-size:16px;line-height:1.6;">${greeting}</p>
<p style="font-size:16px;line-height:1.6;">Thank you for exploring what smarter energy could do for your home. Here's a useful summary of your answers, the opportunities to investigate and what happens next.</p>
<p style="font-size:15px;line-height:1.6;font-weight:700;color:#155943;">${escapeHtml(nextText)}</p>
</td></tr>
<tr><td style="padding:10px 28px 22px;">
<h2 style="font-size:21px;margin:5px 0 14px;color:#17332d;">Your home-energy opportunities</h2>
${prioritiesHtml}
<ul style="margin:0;padding-left:22px;">${highlights}</ul>
<p style="background:#fff9ed;border-left:4px solid #ef9c20;padding:15px;font-size:14px;line-height:1.6;color:#40554f;">${escapeHtml(evidenceNote)} We won't quote savings figures until your electricity charges, GST treatment, seasonal use and roof/site assumptions have been checked.</p>
</td></tr>
<tr><td style="padding:24px 28px;background:#f7f7f2;border-top:1px solid #eee5d9;border-bottom:1px solid #eee5d9;">
<h2 style="font-size:21px;margin:0 0 10px;color:#17332d;">Three pathways worth discussing</h2>
<p style="font-size:15px;line-height:1.6;margin:8px 0;"><strong>Solar Start:</strong> Generate electricity on your roof, with the possibility of adding storage later.</p>
<p style="font-size:15px;line-height:1.6;margin:8px 0;"><strong>Solar Smart:</strong> Use timers and suitable controls to move hot water, EV charging and other flexible loads into solar hours.</p>
<p style="font-size:15px;line-height:1.6;margin:8px 0;"><strong>Solar Smart + Battery:</strong> Store available surplus solar for later; backup and winter performance depend on the design.</p>
<p style="font-size:12px;color:#66736d;line-height:1.6;">These are options to explore, not a final recommendation or formal quote.</p>
</td></tr>
<tr><td style="padding:25px 28px 22px;">
<h2 style="font-size:21px;margin:0 0 12px;color:#17332d;">Explore more with Solectrics</h2>
<p style="margin:9px 0;font-size:15px;line-height:1.5;"><a href="https://solectrics.co.nz/smart-energy.html" style="font-weight:700;color:#147258;">Smart energy for your home →</a><br><span style="color:#62716b;">Hot water, energy controls and EV charging.</span></p>
<p style="margin:15px 0;font-size:15px;line-height:1.5;"><a href="https://solectrics.co.nz/home-battery-guide.html" style="font-weight:700;color:#147258;">Understanding home batteries →</a><br><span style="color:#62716b;">What to expect in summer, winter and outages.</span></p>
<p style="margin:15px 0;font-size:15px;line-height:1.5;"><a href="https://solectrics.co.nz/smart-solar-prices.html" style="font-weight:700;color:#147258;">Explore solar system price guides →</a><br><span style="color:#62716b;">Illustrative packages and what affects a bespoke quote.</span></p>
<p style="margin:15px 0;font-size:15px;line-height:1.5;"><a href="https://solectrics.co.nz/" style="font-weight:700;color:#147258;">About Solectrics →</a><br><span style="color:#62716b;">Our approach to smarter solar living on Waiheke.</span></p>
</td></tr>
<tr><td style="padding:22px 28px 10px;background:#fff;">
<h2 style="font-size:19px;margin:0 0 8px;">Your Home Energy Check answers</h2>
<p style="font-size:13px;color:#61716c;line-height:1.5;margin:0 0 12px;">For your records — we'll verify the details together during a free visit.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;">${rows}</table>
</td></tr>
<tr><td style="padding:27px 28px 32px;background:#fff9ed;border-top:4px solid #ef9c20;">
<h2 style="font-size:24px;margin:0 0 8px;color:#17332d;">Ready for your free bespoke quote?</h2>
<p style="font-size:15px;line-height:1.6;color:#40554f;">We'll visit your home to check your roof, switchboard, hot water, energy use and the right solar, smart-control and battery options. We'll then prepare a quotation tailored to your home.</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:12px 0;">
<a href="${escapeHtml(bookingUrl)}" style="display:inline-block;background:#ef9c20;color:#fff;font-size:15px;font-weight:800;text-decoration:none;text-align:center;border-radius:10px;padding:18px 24px;">BOOK MY FREE HOME SOLAR VISIT →</a>
</td></tr></table>
<p style="font-size:12px;line-height:1.6;color:#64736c;">${escapeHtml(bookingNote)}</p>
<p style="font-size:15px;line-height:1.6;color:#17332d;margin:18px 0 0;">Warmly,<br><strong>Jane at Solectrics</strong></p>
</td></tr>
</table>
<p style="font-size:11px;line-height:1.6;color:#7a817d;margin:16px 0 0;">Solectrics · Waiheke Island, New Zealand · <a style="color:#51766a;" href="https://solectrics.co.nz/">solectrics.co.nz</a></p>
</td></tr></table>
</body></html>`;
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
      from: DEFAULT_HEC_FROM,
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
