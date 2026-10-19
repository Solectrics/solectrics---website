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
    console.error("Job Hub job error:", error);

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
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return errorResponse("job_id is required", 400);
    }

    await ensureJobTypeColumn(db);
    const existing = await db.prepare(
      "SELECT job_type, job_status, next_action FROM jobs WHERE id = ?"
    ).bind(jobId).first();
    if (!existing) return errorResponse("Job not found", 404);

    const jobType = body.job_type === undefined
      ? (existing.job_type || "solar")
      : (body.job_type === "general_electrical" ? "general_electrical" : "solar");
    const allowedStatuses = new Set([
      "New enquiry", "New job", "quoted", "accepted", "scheduled",
      "in_progress", "awaiting_inspection", "completed", "invoiced"
    ]);
    const jobStatus = allowedStatuses.has(body.job_status)
      ? body.job_status
      : (existing.job_status || "New job");
    const nextAction = body.next_action === undefined
      ? (existing.next_action || "")
      : String(body.next_action || "").trim().slice(0, 500);

    const result = await db.prepare(
      "UPDATE jobs SET job_type = ?, job_status = ?, next_action = ? WHERE id = ?"
    ).bind(jobType, jobStatus, nextAction, jobId).run();

    return Response.json({
      ok: true,
      job_type: jobType,
      job_status: jobStatus,
      next_action: nextAction
    });
  } catch (error) {
    console.error("Job Hub job update error:", error);
    return errorResponse("Unable to update job", 500, error.message);
  }
}
