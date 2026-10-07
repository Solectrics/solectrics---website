import { renderHomeEnergyCheckDocument } from "./_home-energy-check-document.js";

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    if (!db) return new Response("Job Hub database is unavailable", { status: 503 });
    const url = new URL(context.request.url);
    const jobId = Number(url.searchParams.get("job_id"));
    if (!Number.isInteger(jobId) || jobId <= 0) return new Response("A valid job_id is required", { status: 400 });
    const row = await db.prepare(`
      SELECT enquiries.answers_json FROM jobs
      JOIN enquiries ON enquiries.id = jobs.enquiry_id
      WHERE jobs.id = ? AND COALESCE(jobs.job_type, 'solar') = 'solar'
    `).bind(jobId).first();
    if (!row) return new Response("Solar job not found", { status: 404 });
    let answers = {};
    try { answers = JSON.parse(row.answers_json || "{}"); } catch {}
    const html = renderHomeEnergyCheckDocument(answers, {
      autoPrint: url.searchParams.get("print") === "1"
    });
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
      }
    });
  } catch (error) {
    console.error("Home Energy Check document error:", error);
    return new Response("Unable to open the Home Energy Check", { status: 500 });
  }
}
