import { ensureJobFileRoleColumn } from "./_schema.js";

const RECIPIENT = "jane@solectrics.co.nz";
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const REQUIRED_ROLE = "fletcher_assessment";
const PACKAGE_ROLES = [REQUIRED_ROLE, "sld", "roof_layout", "power_bill"];

const CREATE_EMAIL_LOGS = `
  CREATE TABLE IF NOT EXISTS email_logs (
    id TEXT PRIMARY KEY,
    job_id INTEGER NOT NULL,
    email_type TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    provider_message_id TEXT,
    status TEXT NOT NULL,
    included_json TEXT,
    missing_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

function errorResponse(message, status = 500, detail) {
  return Response.json(
    { ok: false, error: message, ...(detail ? { detail } : {}) },
    { status }
  );
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function inferRole(file) {
  if (file.document_role && file.document_role !== "general") return file.document_role;
  const text = `${file.original_name || ""} ${file.caption || ""}`.toLowerCase();
  if (text.includes("fletcher") && (text.includes("assessment") || text.includes("checklist"))) {
    return "fletcher_assessment";
  }
  if (/\bsld\b|single[- ]line/.test(text)) return "sld";
  if (/roof.*(layout|plan)|panel.*layout/.test(text)) return "roof_layout";
  if (/(power|electricity).*bill|bill.*(power|electricity)/.test(text)) return "power_bill";
  return "general";
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(binary);
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    const bucket = context.env.JOB_FILES || context.env.UPLOADS || context.env.BUCKET;
    const apiKey = context.env.RESEND_API_KEY;
    if (!db) return errorResponse("D1 database binding DB is not available");
    if (!bucket) return errorResponse("Cloudflare R2 job-file storage is not available", 503);
    if (!apiKey) {
      return errorResponse(
        "Email is not connected yet",
        503,
        "Add the RESEND_API_KEY secret to the Cloudflare Pages project and redeploy"
      );
    }

    const body = await context.request.json();
    const jobId = Number(body.job_id);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return errorResponse("job_id is required", 400);
    }

    await ensureJobFileRoleColumn(db);
    await db.prepare(CREATE_EMAIL_LOGS).run();

    const job = await db.prepare(`
      SELECT jobs.id AS job_id, enquiries.customer_name, enquiries.address
      FROM jobs JOIN enquiries ON enquiries.id = jobs.enquiry_id
      WHERE jobs.id = ?
    `).bind(jobId).first();
    if (!job) return errorResponse("Job not found", 404);

    const result = await db.prepare(`
      SELECT id, storage_key, original_name, content_type, size_bytes,
             category, caption, document_role, uploaded_at
      FROM job_files
      WHERE job_id = ?
      ORDER BY uploaded_at DESC
    `).bind(jobId).all();

    const selected = new Map();
    for (const file of result.results || []) {
      const role = inferRole(file);
      if (PACKAGE_ROLES.includes(role) && !selected.has(role)) selected.set(role, file);
    }
    if (!selected.has(REQUIRED_ROLE)) {
      return errorResponse("Generate the Fletcher form before emailing the package", 400);
    }

    const roleLabels = {
      fletcher_assessment: "Completed Fletcher solar site assessment",
      sld: "Single-line diagram (SLD)",
      roof_layout: "Roof / panel layout",
      power_bill: "Customer power bill"
    };
    const attachments = [];
    const included = [];
    const missing = [];
    let totalBytes = 0;

    for (const role of PACKAGE_ROLES) {
      const file = selected.get(role);
      if (!file) {
        missing.push(roleLabels[role]);
        continue;
      }
      if (totalBytes + Number(file.size_bytes || 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
        if (role === REQUIRED_ROLE) return errorResponse("The completed form is too large to email", 400);
        missing.push(`${roleLabels[role]} (omitted because the package was too large)`);
        continue;
      }
      const object = await bucket.get(file.storage_key);
      if (!object) {
        if (role === REQUIRED_ROLE) return errorResponse("The saved Fletcher form could not be opened", 500);
        missing.push(`${roleLabels[role]} (stored file unavailable)`);
        continue;
      }
      const content = await object.arrayBuffer();
      totalBytes += content.byteLength;
      attachments.push({
        filename: file.original_name,
        content: arrayBufferToBase64(content)
      });
      included.push(roleLabels[role]);
    }

    const subject = `Fletcher solar package – ${job.customer_name || `Job ${jobId}`}`;
    const includedItems = included.map(item => `<li>${escapeHtml(item)}</li>`).join("");
    const missingItems = missing.length
      ? `<p><strong>Not attached / still needed:</strong></p><ul>${missing.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : "<p><strong>All expected documents are attached.</strong></p>";
    const html = `
      <p>Hi Jane,</p>
      <p>Mini Fergus has prepared the Fletcher / J.A. Russell solar package for
         <strong>${escapeHtml(job.customer_name || `Job ${jobId}`)}</strong>.</p>
      <p>${escapeHtml(job.address || "")}</p>
      <p><strong>Attached:</strong></p><ul>${includedItems}</ul>
      ${missingItems}
      <p>Please review the package before forwarding it to Fletcher.</p>
      <p>Mini Fergus</p>
    `;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: context.env.FLETCHER_FROM_EMAIL || "Mini Fergus <mini-fergus@solectrics.co.nz>",
        to: [RECIPIENT],
        subject,
        html,
        attachments
      })
    });
    const resend = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(resend.message || `Resend returned ${response.status}`);
    }

    await db.prepare(`
      INSERT INTO email_logs
        (id, job_id, email_type, recipient, subject, provider_message_id,
         status, included_json, missing_json)
      VALUES (?, ?, 'fletcher_package', ?, ?, ?, 'sent', ?, ?)
    `).bind(
      crypto.randomUUID(), jobId, RECIPIENT, subject, resend.id || null,
      JSON.stringify(included), JSON.stringify(missing)
    ).run();

    return Response.json({
      ok: true,
      recipient: RECIPIENT,
      provider_message_id: resend.id || null,
      included,
      missing
    });
  } catch (error) {
    console.error("Fletcher package email error:", error);
    return errorResponse("Unable to email the Fletcher package", 500, error.message);
  }
}
