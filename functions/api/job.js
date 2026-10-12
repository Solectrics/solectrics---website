import { ensureJobTypeColumn } from "./_schema.js";
import { energyRevision, parseEnergyAnswers, stagingEnergyEnabled } from "./_post-hec-energy.js";

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
      post_hec_bill_processing: stagingEnergyEnabled(context),
      answers_revision: await energyRevision(job.answers_json),
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

    if (body.action === "save_shared_icp") {
      if (!stagingEnergyEnabled(context)) return errorResponse("Shared ICP correction is enabled in the approved staging preview only", 403);
      const row = await db.prepare("SELECT e.id AS enquiry_id, e.answers_json FROM jobs j JOIN enquiries e ON e.id = j.enquiry_id WHERE j.id = ?").bind(jobId).first();
      if (!row) return errorResponse("Job not found", 404);
      if (body.revision !== await energyRevision(row.answers_json)) return errorResponse("Saved information changed. Reload before correcting the ICP.", 409);
      const icp = String(body.icp || "").replace(/\s+/g, "").toUpperCase();
      if (!/^[A-Z0-9]{15}$/.test(icp)) return errorResponse("Enter the complete 15-character ICP from the bill or meter record", 400);
      const answers = parseEnergyAnswers(row.answers_json);
      const updated = {...answers, icp, energy_data:{...(answers.energy_data || {}), revision:crypto.randomUUID(),
        identity_history:[...(answers.energy_data?.identity_history || []), {field:"icp",previous:answers.icp || null,value:icp,source:"staff_review",reviewed_at:new Date().toISOString()}]}};
      const json = JSON.stringify(updated);
      const changed = await db.prepare("UPDATE enquiries SET answers_json = ? WHERE id = ? AND answers_json IS ?").bind(json,row.enquiry_id,row.answers_json).run();
      if (changed.meta?.changes !== 1) return errorResponse("Saved information changed. Nothing was overwritten.", 409);
      return Response.json({ok:true,icp,answers_revision:await energyRevision(json)});
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
