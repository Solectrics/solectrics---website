function getBucket(env) {
  return env.JOB_FILES || env.UPLOADS || env.BUCKET || null;
}

function safeDownloadName(value) {
  return String(value || "job-file").replace(/[\r\n"\\/]/g, "_");
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    const bucket = getBucket(context.env);
    const id = new URL(context.request.url).searchParams.get("id");

    if (!db || !bucket) {
      return Response.json({ error: "Job-file storage is not available" }, { status: 503 });
    }
    if (!id) return Response.json({ error: "File ID is required" }, { status: 400 });

    const row = await db.prepare(`
      SELECT storage_key, original_name, content_type FROM job_files WHERE id = ?
    `).bind(id).first();
    if (!row) return Response.json({ error: "File not found" }, { status: 404 });

    const object = await bucket.get(row.storage_key);
    if (!object) return Response.json({ error: "Stored file not found" }, { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Type", row.content_type || "application/octet-stream");
    headers.set(
      "Content-Disposition",
      `inline; filename="${safeDownloadName(row.original_name)}"`
    );
    headers.set("Cache-Control", "private, max-age=300");
    return new Response(object.body, { headers });
  } catch (error) {
    console.error("Job file download error:", error);
    return Response.json(
      { error: "Unable to open job file", detail: error.message },
      { status: 500 }
    );
  }
}
