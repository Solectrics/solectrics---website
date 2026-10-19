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
        panel_wattage,
        panel_count,
        solar_kw,
        roof_orientation,
        inverter,
        estimated_generation_kwh,

        hot_water_strategy,
        smart_controls,

        battery_option,
        battery_kwh,
        battery_reason,

        current_retailer,
        import_rate,
        export_rate,
        controlled_hot_water,
        recommended_tariff,
        tariff_notes,

        site_notes,
        recommendation,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?,
        CURRENT_TIMESTAMP
      )

      ON CONFLICT(job_id) DO UPDATE SET
        panel_wattage = excluded.panel_wattage,
        panel_count = excluded.panel_count,
        solar_kw = excluded.solar_kw,
        roof_orientation = excluded.roof_orientation,
        inverter = excluded.inverter,
        estimated_generation_kwh = excluded.estimated_generation_kwh,

        hot_water_strategy = excluded.hot_water_strategy,
        smart_controls = excluded.smart_controls,

        battery_option = excluded.battery_option,
        battery_kwh = excluded.battery_kwh,
        battery_reason = excluded.battery_reason,

        current_retailer = excluded.current_retailer,
        import_rate = excluded.import_rate,
        export_rate = excluded.export_rate,
        controlled_hot_water = excluded.controlled_hot_water,
        recommended_tariff = excluded.recommended_tariff,
        tariff_notes = excluded.tariff_notes,

        site_notes = excluded.site_notes,
        recommendation = excluded.recommendation,
        updated_at = CURRENT_TIMESTAMP
    `)
      .bind(
        jobId,

        data.panel_wattage || 445,
        data.panel_count || null,
        data.solar_kw || null,
        data.roof_orientation || null,
        data.inverter || null,
        data.estimated_generation_kwh || null,

        data.hot_water_strategy || null,
        data.smart_controls || null,

        data.battery_option || null,
        data.battery_kwh || null,
        data.battery_reason || null,

        data.current_retailer || null,
        data.import_rate || null,
        data.export_rate || null,
        data.controlled_hot_water || null,
        data.recommended_tariff || null,
        data.tariff_notes || null,

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
      {
        error: "Unable to save assessment",
        detail: error.message
      },
      { status: 500 }
    );
  }
}
