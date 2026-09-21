import { ensureJobTypeColumn } from "./_schema.js";

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;

    if (!db) {
      return Response.json(
        {
          ok: false,
          error: "D1 database binding DB is not available"
        },
        { status: 500 }
      );
    }

    await ensureJobTypeColumn(db);
    const formData = await context.request.formData();
    const answersText = formData.get("answers");

    if (!answersText) {
      return Response.json(
        {
          ok: false,
          error: "Home Energy Check answers are missing"
        },
        { status: 400 }
      );
    }

    let answers;

    try {
      answers = JSON.parse(answersText);
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: "Home Energy Check answers could not be read"
        },
        { status: 400 }
      );
    }

    const customerName =
      answers.name ||
      answers.customer_name ||
      "Unnamed customer";

    const email =
      answers.email ||
      "";

    const phone =
      answers.phone ||
      "";

    const address =
      answers.address ||
      "";

    const createdAt = new Date().toISOString();

    /*
      Create the enquiry.
      answers_json keeps the complete Home Energy Check so Job Hub
      can use the customer's original answers later.
    */

    const enquiryResult = await db
      .prepare(`
        INSERT INTO enquiries
        (
          enquiry_ref,
          created_at,
          customer_name,
          email,
          phone,
          address,
          answers_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        crypto.randomUUID(),
        createdAt,
        customerName,
        email,
        phone,
        address,
        JSON.stringify(answers)
      )
      .run();

    const enquiryId = enquiryResult.meta.last_row_id;

    if (!enquiryId) {
      throw new Error("Enquiry was not created");
    }

    /*
      Automatically create the linked Job Hub record.
    */

    const jobResult = await db
      .prepare(`
        INSERT INTO jobs
        (
          enquiry_id,
          job_status,
          next_action,
          job_type
        )
        VALUES (?, ?, ?, ?)
      `)
      .bind(
        enquiryId,
        "New enquiry",
        "Review Home Energy Check",
        "solar"
      )
      .run();

    const jobId = jobResult.meta.last_row_id;

    return Response.json({
      ok: true,
      enquiryRef: enquiryId,
      jobId: jobId,
      receivedAt: createdAt
    });

  } catch (error) {
    console.error("Home Energy Check submission error:", error);

    return Response.json(
      {
        ok: false,
        error: error.message || "Could not save Home Energy Check"
      },
      { status: 500 }
    );
  }
}
