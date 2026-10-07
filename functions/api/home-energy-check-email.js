import { sendHomeEnergyCheckEmail } from "./_home-energy-check-document.js";

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) return Response.json({ ok: false, error: "Job Hub database is unavailable" }, { status: 503 });
    const body = await context.request.json();
    const jobId = Number(body.job_id);
    if (!Number.isInteger(jobId) || jobId <= 0) return Response.json({ ok: false, error: "A valid job_id is required" }, { status: 400 });
    const row = await db.prepare(`
      SELECT enquiries.answers_json, enquiries.email FROM jobs
      JOIN enquiries ON enquiries.id = jobs.enquiry_id
      WHERE jobs.id = ? AND COALESCE(jobs.job_type, 'solar') = 'solar'
    `).bind(jobId).first();
    if (!row) return Response.json({ ok: false, error: "Solar job not found" }, { status: 404 });
    let answers = {};
    try { answers = JSON.parse(row.answers_json || "{}"); } catch {}
    await sendHomeEnergyCheckEmail(context.env, answers, row.email);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Home Energy Check email error:", error);
    return Response.json({ ok: false, error: error.message || "Unable to email the Home Energy Check" }, { status: 500 });
  }
}
