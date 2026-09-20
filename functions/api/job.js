import { ensureJobTypeColumn } from "./_schema.js";

function errorResponse(message, status = 500, detail) {
  return Response.json(
    { ok: false, error: message, ...(detail ? { detail } : {}) },
    { status }
  );
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;

    if (!db) {
      return Response.json(
        { error: "D1 database binding DB is not available" },
        { status: 500 }
      );
    }

    await ensureJobTypeColumn(db);
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
        jobs.job_type,
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

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) return errorResponse("D1 database binding DB is not available");

    const body = await context.request.json();
    const jobId = Number(body.job_id);
    const jobType = body.job_type === "general_electrical" ? "general_electrical" : "solar";
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return errorResponse("job_id is required", 400);
    }

    await ensureJobTypeColumn(db);
    const result = await db.prepare(
      "UPDATE jobs SET job_type = ? WHERE id = ?"
    ).bind(jobType, jobId).run();
    if (!result.meta?.changes) return errorResponse("Job not found", 404);

    return Response.json({ ok: true, job_type: jobType });
  } catch (error) {
    console.error("Mini Fergus job update error:", error);
    return errorResponse("Unable to update job", 500, error.message);
  }
}
