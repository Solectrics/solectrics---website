export async function onRequestGet(context) {
  try {
    const db = context.env.DB;

    if (!db) {
      return Response.json(
        { error: "D1 database binding DB is not available" },
        { status: 500 }
      );
    }

    const { results } = await db.prepare(`
      SELECT
        jobs.id AS job_id,
        jobs.job_status,
        jobs.next_action,
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
    console.error("Mini Fergus jobs error:", error);

    return Response.json(
      {
        ok: false,
        error: error.message
      },
      { status: 500 }
    );
  }
}
