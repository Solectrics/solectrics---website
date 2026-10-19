import { ensureJobTypeColumn } from "./_schema.js";

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
    const { results } = await db.prepare(`
      SELECT
        jobs.id AS job_id,
        jobs.job_status,
        jobs.next_action,
        jobs.job_type,
        enquiries.id AS enquiry_id,
        enquiries.enquiry_ref,
        enquiries.created_at,
        enquiries.customer_name,
        enquiries.email,
        enquiries.phone,
        enquiries.address
      FROM jobs
      JOIN enquiries ON jobs.enquiry_id = enquiries.id
      ORDER BY jobs.id DESC
    `).all();

    return Response.json({
      ok: true,
      jobs: results
    });

  } catch (error) {
    console.error("Job Hub jobs error:", error);

    return Response.json(
      {
        ok: false,
        error: error.message
      },
      { status: 500 }
    );
  }
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) {
      return Response.json(
        { ok: false, error: "D1 database binding DB is not available" },
        { status: 500 }
      );
    }

    const body = await context.request.json();
    const customerName = cleanText(body.customer_name, 160);
    const email = cleanText(body.email, 254);
    const phone = cleanText(body.phone, 80);
    const address = cleanText(body.address, 300);
    const jobDescription = cleanText(body.job_description, 3000);

    if (!customerName) {
      return Response.json(
        { ok: false, error: "Customer name is required" },
        { status: 400 }
      );
    }

    await ensureJobTypeColumn(db);
    const createdAt = new Date().toISOString();
    const enquiryRef = crypto.randomUUID();
    const answers = {
      source: "mini_fergus_general_electrical",
      jobDescription
    };

    const enquiryResult = await db.prepare(`
      INSERT INTO enquiries
        (enquiry_ref, created_at, customer_name, email, phone, address, answers_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      enquiryRef,
      createdAt,
      customerName,
      email,
      phone,
      address,
      JSON.stringify(answers)
    ).run();

    const enquiryId = enquiryResult.meta?.last_row_id;
    if (!enquiryId) throw new Error("Customer record was not created");

    const jobResult = await db.prepare(`
      INSERT INTO jobs (enquiry_id, job_status, next_action, job_type)
      VALUES (?, ?, ?, ?)
    `).bind(
      enquiryId,
      "New job",
      "Review electrical work requested",
      "general_electrical"
    ).run();

    const jobId = jobResult.meta?.last_row_id;
    if (!jobId) throw new Error("Job was not created");

    return Response.json({ ok: true, job_id: jobId, enquiry_ref: enquiryRef });
  } catch (error) {
    console.error("Job Hub create job error:", error);
    return Response.json(
      { ok: false, error: "Unable to create general electrical job", detail: error.message },
      { status: 500 }
    );
  }
}
