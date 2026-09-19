const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS job_files (
    id TEXT PRIMARY KEY,
    job_id INTEGER NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    content_type TEXT,
    size_bytes INTEGER NOT NULL,
    category TEXT NOT NULL,
    caption TEXT,
    uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
  "application/pdf"
]);
const ALLOWED_CATEGORIES = new Set([
  "site_photo", "switchboard", "meter", "roof", "equipment",
  "drawing", "supplier", "certificate", "other"
]);

function getBucket(env) {
  return env.JOB_FILES || env.UPLOADS || env.BUCKET || null;
}

function errorResponse(message, status = 500, detail) {
  return Response.json(
    { ok: false, error: message, ...(detail ? { detail } : {}) },
    { status }
  );
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    const jobId = Number(new URL(context.request.url).searchParams.get("job_id"));
    if (!db) return errorResponse("D1 database binding DB is not available");
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return errorResponse("job_id is required", 400);
    }

    await db.prepare(CREATE_TABLE).run();
    const result = await db.prepare(`
      SELECT id, original_name, content_type, size_bytes, category, caption, uploaded_at
      FROM job_files
      WHERE job_id = ?
      ORDER BY uploaded_at DESC
    `).bind(jobId).all();

    return Response.json({ ok: true, files: result.results || [] });
  } catch (error) {
    console.error("Job files GET error:", error);
    return errorResponse("Unable to load job files", 500, error.message);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    const bucket = getBucket(context.env);
    if (!db) return errorResponse("D1 database binding DB is not available");
    if (!bucket) {
      return errorResponse(
        "Cloudflare R2 job-file storage is not connected yet",
        503,
        "Add an R2 binding named JOB_FILES"
      );
    }

    const form = await context.request.formData();
    const jobId = Number(form.get("job_id"));
    const file = form.get("file");
    const categoryValue = String(form.get("category") || "other");
    const category = ALLOWED_CATEGORIES.has(categoryValue) ? categoryValue : "other";
    const caption = String(form.get("caption") || "").trim().slice(0, 500);

    if (!Number.isInteger(jobId) || jobId <= 0) {
      return errorResponse("job_id is required", 400);
    }
    if (!(file instanceof File) || !file.size) {
      return errorResponse("Choose a file to upload", 400);
    }
    if (file.size > MAX_FILE_SIZE) {
      return errorResponse("Please use a file under 12 MB", 400);
    }

    const contentType = file.type || "application/octet-stream";
    if (!ALLOWED_TYPES.has(contentType)) {
      return errorResponse("Please upload a photo or PDF", 400);
    }

    await db.prepare(CREATE_TABLE).run();
    const id = crypto.randomUUID();
    const extension = file.name.includes(".")
      ? `.${file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "")}`
      : "";
    const storageKey = `jobs/${jobId}/${id}${extension}`;

    await bucket.put(storageKey, await file.arrayBuffer(), {
      httpMetadata: { contentType },
      customMetadata: { jobId: String(jobId), originalName: file.name }
    });

    try {
      await db.prepare(`
        INSERT INTO job_files
          (id, job_id, storage_key, original_name, content_type, size_bytes, category, caption)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, jobId, storageKey, file.name.slice(0, 255), contentType,
        file.size, category, caption || null
      ).run();
    } catch (error) {
      await bucket.delete(storageKey);
      throw error;
    }

    return Response.json({ ok: true, id, message: "File uploaded" });
  } catch (error) {
    console.error("Job files POST error:", error);
    return errorResponse("Unable to upload job file", 500, error.message);
  }
}
