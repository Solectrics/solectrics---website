export async function onRequestGet(context) {
  try {
    const db = context.env.DB;

    if (!db) {
      return Response.json(
        { error: "D1 database binding DB is not available" },
        { status: 500 }
      );
    }

    const url = new URL(context.request.url);
    const jobId = url.searchParams.get("id");

    if (!jobId) {
      return Response.json(
        { error: "Job ID is required" },
        { status: 400 }
      );
    }

    const job = await db.prepare(`
      SELECT
        jobs.id AS job_id,
        jobs.job_status,
        jobs.next_action,
        enquiries.*
      FROM jobs
      JOIN enquiries ON jobs.enquiry_id = enquiries.id
      WHERE jobs.id = ?
    `).bind(jobId).first();

    if (!job) {
      return Response.json(
        { error: "Job not found" },
        { status: 404 }
      );
    }

    return Response.json({
      ok: true,
      job: job
    });

  } catch (error) {
    console.error("Mini Fergus job error:", error);

    return Response.json(
      {
        ok: false,
        error: error.message
      },
      { status: 500 }
    );
  }
}
