import { ensureJobFileRoleColumn, ensureJobTypeColumn } from "./_schema.js";
import { identifyEnergyDataDetail } from "./job-files.js";


const MAX_FILE_SIZE = 12 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf", "csv", "xls", "xlsx"]);

function getBucket(env) {
  return env.JOB_FILES || env.UPLOADS || env.BUCKET || null;
}

function formFiles(formData, name) {
  return formData.getAll(name).filter(value => value instanceof File && (value.name || value.size));
}

function extensionOf(file) {
  return file.name.includes(".") ? file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

function validateFiles(files) {
  if (files.length > 24) throw new Error("Please attach at most 24 files.");
  for (const { file } of files) {
    if (!file.size) throw new Error("An attachment is empty. Please choose a non-empty file.");
    if (file.size > MAX_FILE_SIZE) throw new Error(`${file.name} is over the 12 MB limit`);
    if (!ALLOWED_EXTENSIONS.has(extensionOf(file))) {
      throw new Error(`${file.name} is not a supported image, PDF, CSV or Excel file`);
    }
  }
}

function annualUploadRole(file, annualFiles) {
  const extension = extensionOf(file);
  if (["csv", "xls", "xlsx"].includes(extension)) return "annual_usage";
  const allBillLike = annualFiles.length > 1 && annualFiles.every(item => ["pdf", "jpg", "jpeg", "png", "webp", "heic", "heif"].includes(extensionOf(item)));
  return allBillLike ? "additional_power_bill" : "annual_usage";
}

export async function onRequestPost(context) {
  let enquiryId, jobId, bucket;
  const storedKeys = [];
  const db = context.env.DB;
  let validationError = false;
  try {
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

    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      return Response.json({ok:false,error:"Home Energy Check answers must be an object"},{status:400});
    }
    answers.customerCopyOptIn = false; // Email delivery requires the protected email-only action.
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
    const recentBillFiles = [
      ...formFiles(formData, "summer_bill"),
      ...formFiles(formData, "winter_bill")
    ];
    const annualFiles = formFiles(formData, "annual_usage_files");
    const uploads = [
      ...recentBillFiles.map(file => ({ file, role: "power_bill", caption: "Electricity bill supplied with Home Energy Check" })),
      ...annualFiles.map(file => {
        const role = annualUploadRole(file, annualFiles);
        return {
          file,
          role,
          caption: role === "annual_usage" ? "12-month electricity usage supplied with Home Energy Check" : "Additional electricity bill supplied with Home Energy Check"
        };
      })
    ];
    try { validateFiles(uploads); } catch { validationError = true; throw new Error("Please check attachment types, sizes and file count."); }
    bucket = uploads.length ? getBucket(context.env) : null;
    // Multipart bytes are authoritative; never trust a client-supplied attachment list.
    answers.energyDataUploads = {
      recentBills: recentBillFiles.map(file => ({name:file.name,type:file.type || "unknown"})),
      annualUsage: annualFiles.map(file => ({name:file.name,type:file.type || "unknown"}))
    };
    answers.attachmentManifest = [];
    if (uploads.length && !bucket) throw new Error("File storage is not available. Please try again later.");

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

    enquiryId = enquiryResult.meta.last_row_id;

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
        answers.followUpRequest === "free_site_visit" ? "Contact customer to arrange free site visit" : "Review Home Energy Check",
        "solar"
      )
      .run();

    jobId = jobResult.meta.last_row_id;
    if (!jobId) throw new Error("Linked job was not created");

    if (uploads.length) {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS job_files (
          id TEXT PRIMARY KEY,
          job_id INTEGER NOT NULL,
          storage_key TEXT NOT NULL UNIQUE,
          original_name TEXT NOT NULL,
          content_type TEXT,
          size_bytes INTEGER NOT NULL,
          category TEXT NOT NULL,
          caption TEXT,
          document_role TEXT,
          energy_data_detail TEXT,
          uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      await ensureJobFileRoleColumn(db);
      for (const upload of uploads) {
        const id = crypto.randomUUID();
        const extension = extensionOf(upload.file);
        const storageKey = `jobs/${jobId}/${id}${extension ? `.${extension}` : ""}`;
        const contentType = upload.file.type || "application/octet-stream";
        const detail = await identifyEnergyDataDetail(upload.file, upload.role);
        storedKeys.push(storageKey);
        await bucket.put(storageKey, await upload.file.arrayBuffer(), {
          httpMetadata: { contentType },
          customMetadata: { jobId: String(jobId), originalName: upload.file.name }
        });
        await db.prepare(`
          INSERT INTO job_files
            (id, job_id, storage_key, original_name, content_type, size_bytes,
             category, caption, document_role, energy_data_detail, uploaded_at)
          VALUES (?, ?, ?, ?, ?, ?, 'other', ?, ?, ?, ?)
        `).bind(
          id, jobId, storageKey, upload.file.name.slice(0, 255), contentType,
          upload.file.size, upload.caption, upload.role, detail, createdAt
        ).run();
      }
    }
    answers.attachmentManifest = uploads.map((upload, index) => ({
      name:upload.file.name.slice(0,255), role:upload.role, size:upload.file.size,
      id:storedKeys[index].split('/').pop().split('.')[0]
    }));
    if (uploads.length) await db.prepare("UPDATE enquiries SET answers_json = ? WHERE id = ?")
      .bind(JSON.stringify(answers), enquiryId).run();

    const customerCopy = {requested:false,sent:false};

    return Response.json({
      ok: true,
      enquiryRef: enquiryId,
      jobId: jobId,
      receivedAt: createdAt,
      customerCopy,
      attachmentCount: uploads.length
    });

  } catch (error) {
    // Cleanup only records and keys created by this request. Do not log customer data.
    const cleanup = [];
    for (const key of storedKeys) cleanup.push(() => bucket.delete(key));
    if (jobId) {
      cleanup.push(() => db.prepare("DELETE FROM job_files WHERE job_id = ?").bind(jobId).run());
      cleanup.push(() => db.prepare("DELETE FROM jobs WHERE id = ?").bind(jobId).run());
    }
    if (enquiryId) cleanup.push(() => db.prepare("DELETE FROM enquiries WHERE id = ?").bind(enquiryId).run());
    let cleanupFailed = false;
    for (const action of cleanup) { try { await action(); } catch { cleanupFailed = true; } }
    console.error(cleanupFailed ? "Home Energy Check save failed; cleanup needs operator review." : "Home Energy Check save failed.");

    return Response.json(
      {
        ok: false,
        error: validationError ? "Please check attachment types, sizes and file count. Files must be non-empty and at most 12 MB each." : "Could not save your Home Energy Check and attachments. Please try again or contact Solectrics."
      },
      { status: validationError ? 400 : 500 }
    );
  }
}
