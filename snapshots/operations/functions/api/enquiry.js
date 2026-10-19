import { ensureJobFileRoleColumn, ensureJobTypeColumn } from "./_schema.js";
import { identifyEnergyDataDetail } from "./job-files.js";
import { sendHomeEnergyCheckCopy } from "./_hec-customer-copy.js";

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf", "csv", "xls", "xlsx"]);

function getBucket(env) {
  return env.JOB_FILES || env.UPLOADS || env.BUCKET || null;
}

function formFiles(formData, name) {
  return formData.getAll(name).filter(value => value instanceof File && value.size);
}

function extensionOf(file) {
  return file.name.includes(".") ? file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

function validateFiles(files) {
  for (const { file } of files) {
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
    validateFiles(uploads);
    const bucket = uploads.length ? getBucket(context.env) : null;
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

    if (jobId) {
      const supplierReference = `S${String(jobId).padStart(4, "0")}`;
      await db.prepare("UPDATE jobs SET supplier_reference = ? WHERE id = ? AND (supplier_reference IS NULL OR supplier_reference = '')")
        .bind(supplierReference, jobId).run();
    }

    if (uploads.length) {
      const storedKeys = [];
      try {
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
          await bucket.put(storageKey, await upload.file.arrayBuffer(), {
            httpMetadata: { contentType },
            customMetadata: { jobId: String(jobId), originalName: upload.file.name }
          });
          storedKeys.push(storageKey);
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
      } catch (error) {
        await Promise.all(storedKeys.map(key => bucket.delete(key)));
        await db.prepare("DELETE FROM job_files WHERE job_id = ?").bind(jobId).run();
        await db.prepare("DELETE FROM jobs WHERE id = ?").bind(jobId).run();
        await db.prepare("DELETE FROM enquiries WHERE id = ?").bind(enquiryId).run();
        throw error;
      }
    }

    const customerCopy = { requested: Boolean(answers.customerCopyOptIn), sent: false };
    if (customerCopy.requested) {
      try {
        await sendHomeEnergyCheckCopy(context.env, answers, email);
        customerCopy.sent = true;
      } catch (emailError) {
        console.error("Home Energy Check was saved, but the customer copy email failed:", emailError);
      }
    }

    return Response.json({
      ok: true,
      enquiryRef: enquiryId,
      jobId: jobId,
      receivedAt: createdAt,
      customerCopy
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
