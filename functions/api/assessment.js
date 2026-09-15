export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    const url = new URL(context.request.url);
    const jobId = Number(url.searchParams.get("job_id"));

    if (!db) {
      return Response.json(
        { error: "D1 database binding DB is not available" },
        { status: 500 }
      );
    }

    if (!jobId) {
      return Response.json(
        { error: "job_id is required" },
        { status: 400 }
      );
    }

    const assessment = await db
      .prepare("SELECT * FROM assessments WHERE job_id = ?")
      .bind(jobId)
      .first();

    return Response.json({
      ok: true,
      assessment: assessment || null
    });

  } catch (error) {
    console.error("Assessment GET error:", error);

    return Response.json(
      { error: "Unable to load assessment" },
      { status: 500 }
    );
  }
}


export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    const data = await context.request.json();
    const jobId = Number(data.job_id);

    if (!db) {
      return Response.json(
        { error: "D1 database binding DB is not available" },
        { status: 500 }
      );
    }

    if (!jobId) {
      return Response.json(
        { error: "job_id is required" },
        { status: 400 }
      );
    }

    await db.prepare(`
      INSERT INTO assessments (
        job_id,
        solar_kw,
        panel_count,
        inverter,
        estimated_generation_kwh,
        hot_water_strategy,
        smart_controls,
        battery_option,
        battery_kwh,
        tariff_recommendation,
        site_notes,
        recommendation,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)

      ON CONFLICT(job_id) DO UPDATE SET
        solar_kw = excluded.solar_kw,
        panel_count = excluded.panel_count,
        inverter = excluded.inverter,
        estimated_generation_kwh = excluded.estimated_generation_kwh,
        hot_water_strategy = excluded.hot_water_strategy,
        smart_controls = excluded.smart_controls,
        battery_option = excluded.battery_option,
        battery_kwh = excluded.battery_kwh,
        tariff_recommendation = excluded.tariff_recommendation,
        site_notes = excluded.site_notes,
        recommendation = excluded.recommendation,
        updated_at = CURRENT_TIMESTAMP
    `)
      .bind(
        jobId,
        data.solar_kw || null,
        data.panel_count || null,
        data.inverter || null,
        data.estimated_generation_kwh || null,
        data.hot_water_strategy || null,
        data.smart_controls || null,
        data.battery_option || null,
        data.battery_kwh || null,
        data.tariff_recommendation || null,
        data.site_notes || null,
        data.recommendation || null
      )
      .run();

    return Response.json({
      ok: true,
      message: "Assessment saved"
    });

  } catch (error) {
    console.error("Assessment POST error:", error);

    return Response.json(
      { error: "Unable to save assessment" },
      { status: 500 }
    );
  }
}
