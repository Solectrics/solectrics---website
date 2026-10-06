import { rankSupplierJobSuggestions, supplierInvoiceDuplicate, supplierInvoiceAmountsReconcile } from "./supplier-invoice-matching.js";
import { ensureJobFileRoleColumn } from "./_schema.js";
import { onRequestPost as readSupplierInvoice } from "./supplier-invoice-read.js";

const MAX_PDF_BYTES = 12 * 1024 * 1024;
const JOB_FILES_TABLE = `CREATE TABLE IF NOT EXISTS job_files (
  id TEXT PRIMARY KEY, job_id INTEGER NOT NULL, storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL, content_type TEXT, size_bytes INTEGER NOT NULL,
  category TEXT NOT NULL, caption TEXT, document_role TEXT, energy_data_detail TEXT,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
const JOB_MATERIALS_TABLE = `CREATE TABLE IF NOT EXISTS job_materials (
  id TEXT PRIMARY KEY, job_id INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'supplier_invoice',
  supplier_name TEXT, invoice_number TEXT, invoice_date TEXT, invoice_file_id TEXT,
  description TEXT NOT NULL, supplier_sku TEXT, quantity REAL NOT NULL DEFAULT 1,
  unit_code TEXT, unit_cost_ex_gst REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

function fail(message, status = 400) { return Response.json({ ok: false, error: message }, { status }); }
function clean(value, limit = 500) { return String(value ?? "").trim().slice(0, limit); }
function money(value) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100; }
function isoDate(value) { const text = clean(value, 10); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null; }
function getBucket(env) { return env.JOB_FILES || env.UPLOADS || env.BUCKET || null; }
async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function resolveBook(db, body, recipient) {
  const requested = clean(body.book_id, 100);
  if (requested) return db.prepare("SELECT * FROM bookkeeping_books WHERE id = ? AND active = 1").bind(requested).first();
  if (recipient) {
    const address = await db.prepare(`SELECT b.* FROM bookkeeping_supplier_inbox_addresses a
      JOIN bookkeeping_books b ON b.id = a.book_id WHERE a.email_address = ? COLLATE NOCASE AND a.active = 1 AND b.active = 1`)
      .bind(recipient).first();
    return address || null;
  }
  const books = await db.prepare("SELECT * FROM bookkeeping_books WHERE active = 1 ORDER BY name").all();
  return (books.results || []).length === 1 ? books.results[0] : null;
}

async function jobSuggestions(db, purchaseOrderReference, bookId) {
  const result = await db.prepare(`SELECT j.id AS job_id, j.job_status, j.next_action, j.supplier_reference,
      e.enquiry_ref, e.customer_name, e.email, e.address
    FROM jobs j JOIN enquiries e ON e.id = j.enquiry_id
    LEFT JOIN bookkeeping_job_books jb ON jb.job_id = j.id
    WHERE jb.job_id IS NULL OR jb.book_id = ? ORDER BY j.id DESC`).bind(bookId).all();
  return rankSupplierJobSuggestions(result.results || [], purchaseOrderReference);
}

async function getReceivedAttachments(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    const body = Object.fromEntries(["book_id", "recipient_email", "sender_email", "email_subject", "email_message_id", "source_type"].map(key => [key, form.get(key)]));
    const files = [...form.getAll("attachment"), ...form.getAll("attachments"), ...form.getAll("file")].filter(file => file instanceof File && file.size);
    return { body, files: await Promise.all(files.map(async file => ({ name: file.name, content_type: file.type || "application/pdf", bytes: new Uint8Array(await file.arrayBuffer()) }))) };
  }
  const body = await request.json();
  const attachments = Array.isArray(body.attachments) ? body.attachments : body.attachment ? [body.attachment] : [];
  const files = attachments.map((attachment, index) => {
    const data = String(attachment.content_base64 || attachment.base64 || "").replace(/^data:[^,]+,/, "");
    if (!data) throw new Error(`Attachment ${index + 1} has no base64 file data`);
    let binary;
    try { binary = atob(data); } catch { throw new Error(`Attachment ${index + 1} has invalid base64 data`); }
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return { name: clean(attachment.filename || attachment.name || `supplier-invoice-${index + 1}.pdf`, 255), content_type: clean(attachment.content_type || "application/pdf", 120), bytes };
  });
  return { body, files };
}

function authorizedSource(request, env, sourceType) {
  if (!new Set(["zapier", "direct_email", "email_webhook"]).has(sourceType)) return true;
  const expected = String(env.SUPPLIER_INBOX_SECRET || "");
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

async function receiveOne(db, bucket, book, body, file, sourceType) {
  if (!file.name.toLowerCase().endsWith(".pdf") || file.content_type !== "application/pdf") throw new Error(`${file.name}: supplier inbox currently accepts PDF invoices only`);
  if (!file.bytes.length || file.bytes.length > MAX_PDF_BYTES) throw new Error(`${file.name}: PDF must be smaller than 12 MB`);
  const hash = await sha256(file.bytes);
  const sender = clean(body.sender_email, 254).toLowerCase() || null;
  const recipient = clean(body.recipient_email, 254).toLowerCase() || null;
  const messageId = clean(body.email_message_id, 500) || null;
  if (messageId) {
    const replay = await db.prepare(`SELECT id, matching_status FROM bookkeeping_supplier_invoice_inbox
      WHERE book_id = ? AND email_message_id = ? AND attachment_name = ? AND content_sha256 = ? LIMIT 1`)
      .bind(book.id, messageId, file.name, hash).first();
    if (replay) return { id: replay.id, duplicate_delivery: true, status: replay.matching_status };
  }
  const exactDuplicate = await db.prepare(`SELECT id, storage_key FROM bookkeeping_supplier_invoice_inbox
    WHERE book_id = ? AND content_sha256 = ? AND duplicate_of_id IS NULL ORDER BY received_at LIMIT 1`)
    .bind(book.id, hash).first();
  const id = crypto.randomUUID();
  const storageKey = exactDuplicate?.storage_key || `supplier-inbox/${book.id}/${id}.pdf`;
  let uploaded = false;
  if (!exactDuplicate) {
    await bucket.put(storageKey, file.bytes, {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { supplierInboxId: id, bookId: book.id, originalName: file.name }
    });
    uploaded = true;
  }
  const duplicateOf = exactDuplicate?.id || null;
  try {
    await db.prepare(`INSERT INTO bookkeeping_supplier_invoice_inbox
      (id, book_id, source_type, sender_email, recipient_email, email_subject, email_message_id,
       attachment_name, content_type, size_bytes, content_sha256, storage_key, matching_status,
       duplicate_of_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?)`)
      .bind(id, book.id, sourceType, sender, recipient, clean(body.email_subject, 500) || null,
        messageId, file.name, file.bytes.length, hash, storageKey,
        duplicateOf ? "duplicate" : "needs_matching", duplicateOf).run();
    await db.prepare(`INSERT INTO bookkeeping_supplier_invoice_events
      (id, book_id, inbox_id, action, actor, details_json)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), book.id, id, duplicateOf ? "duplicate_received" : "received",
        sourceType, JSON.stringify({ sender_email: sender, recipient_email: recipient, email_subject: clean(body.email_subject, 500), duplicate_of_id: duplicateOf })).run();
  } catch (error) {
    if (uploaded) await bucket.delete(storageKey);
    throw error;
  }
  return { id, duplicate_delivery: false, duplicate_of_id: duplicateOf, status: duplicateOf ? "duplicate" : "needs_matching" };
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    if (!db) return fail("D1 database binding DB is not available", 500);
    const url = new URL(context.request.url);
    if (url.searchParams.get("view") === "books") {
      const rows = await db.prepare("SELECT id, name FROM bookkeeping_books WHERE active = 1 ORDER BY name").all();
      return Response.json({ ok: true, books: rows.results || [] });
    }
    const bookId = clean(url.searchParams.get("book_id"), 100);
    if (!bookId) return fail("book_id is required");
    const inboxId = clean(url.searchParams.get("inbox_id"), 100);
    if (inboxId) {
      const row = await db.prepare(`SELECT * FROM bookkeeping_supplier_invoice_inbox WHERE id = ? AND book_id = ?`).bind(inboxId, bookId).first();
      if (!row) return fail("Supplier invoice not found", 404);
      let extraction = {}, warnings = [], suggestedJobs = [];
      try { extraction = JSON.parse(row.extraction_json || "{}"); } catch {}
      try { warnings = JSON.parse(row.extraction_warnings_json || "[]"); } catch {}
      try { suggestedJobs = JSON.parse(row.suggested_job_ids_json || "[]"); } catch {}
      if (row.purchase_order_reference) suggestedJobs = await jobSuggestions(db, row.purchase_order_reference, bookId);
      return Response.json({ ok: true, invoice: { ...row, storage_key: undefined, extraction_json: undefined, extraction_warnings_json: undefined, suggested_job_ids_json: undefined, extraction, warnings, suggested_jobs: suggestedJobs, document_url: `/api/supplier-invoice-inbox-file?id=${encodeURIComponent(row.id)}&book_id=${encodeURIComponent(bookId)}` } });
    }
    const status = clean(url.searchParams.get("status"), 40);
    const result = await db.prepare(`SELECT id, source_type, sender_email, email_subject, received_at,
      attachment_name, size_bytes, supplier_name, supplier_invoice_number, supplier_invoice_date,
      purchase_order_reference, subtotal_ex_gst, gst_amount, total_incl_gst,
      extraction_status, extraction_confidence, matching_status, job_id, duplicate_of_id
      FROM bookkeeping_supplier_invoice_inbox WHERE book_id = ? ${status ? "AND matching_status = ?" : ""}
      ORDER BY received_at DESC LIMIT 200`).bind(...(status ? [bookId, status] : [bookId])).all();
    return Response.json({ ok: true, invoices: result.results || [] });
  } catch (error) {
    console.error("Supplier invoice inbox GET error:", error);
    return fail("Unable to load supplier invoice inbox", 500);
  }
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  if (!db) return fail("D1 database binding DB is not available", 500);
  const bucket = getBucket(context.env);
  if (!bucket) return fail("Job-file storage is not available", 503);
  try {
    const type = context.request.headers.get("content-type") || "";
    const multipart = type.includes("multipart/form-data");
    const jsonBody = multipart ? null : await context.request.clone().json();
    if (multipart || Array.isArray(jsonBody?.attachments) || jsonBody?.attachment) {
      const received = await getReceivedAttachments(context.request);
      const body = received.body || {};
      const sourceType = ["zapier", "direct_email", "email_webhook", "manual_upload"].includes(body.source_type) ? body.source_type : "manual_upload";
      if (!authorizedSource(context.request, context.env, sourceType)) return fail("Supplier inbox source is not authenticated", 401);
      const recipient = clean(body.recipient_email, 254).toLowerCase();
      const book = await resolveBook(db, body, recipient);
      if (!book) return fail("Select a bookkeeping business or configure this inbox address to route to one", 400);
      if (!received.files.length) return fail("Email did not contain a PDF invoice attachment");
      if (received.files.length > 10) return fail("A single email can contain no more than 10 PDF attachments");
      const outcomes = [];
      for (const file of received.files) {
        const outcome = await receiveOne(db, bucket, book, body, file, sourceType);
        if (!outcome.duplicate_delivery && !outcome.duplicate_of_id && context.env.OPENAI_API_KEY) {
          try {
            const internalRequest = new Request(new URL("/api/supplier-invoice-read", context.request.url), {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ inbox_id: outcome.id })
            });
            const readResponse = await readSupplierInvoice({ request: internalRequest, env: context.env });
            const readData = await readResponse.json();
            if (!readResponse.ok || !readData.ok) outcome.extraction_error = readData.error || "Invoice reading is pending review";
            else outcome.extraction_status = "complete";
          } catch (error) {
            console.warn("Supplier invoice stored; automatic reading will need retry:", error.message);
            outcome.extraction_error = "Automatic reading is pending; the PDF is safely stored in the inbox.";
          }
        }
        outcomes.push(outcome);
      }
      return Response.json({ ok: true, book_id: book.id, received_count: outcomes.length, invoices: outcomes }, { status: 201 });
    }

    const body = jsonBody || await context.request.json();
    if (body.action === "create_inbox_address") {
      const bookId = clean(body.book_id, 100);
      const address = clean(body.email_address, 254).toLowerCase();
      if (!bookId || !(await db.prepare("SELECT id FROM bookkeeping_books WHERE id = ? AND active = 1").bind(bookId).first())) return fail("A valid book_id is required");
      if (!/^\S+@\S+\.\S+$/.test(address)) return fail("Enter a valid supplier inbox email address");
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO bookkeeping_supplier_inbox_addresses (id, book_id, email_address) VALUES (?, ?, ?)").bind(id, bookId, address).run();
      return Response.json({ ok: true, id, email_address: address }, { status: 201 });
    }

    if (body.action === "approve_and_post") {
      await db.prepare(JOB_FILES_TABLE).run();
      await ensureJobFileRoleColumn(db);
      await db.prepare(JOB_MATERIALS_TABLE).run();
      const id = clean(body.inbox_id, 100);
      const bookId = clean(body.book_id, 100);
      const row = await db.prepare("SELECT * FROM bookkeeping_supplier_invoice_inbox WHERE id = ? AND book_id = ?").bind(id, bookId).first();
      if (!row) return fail("Supplier invoice not found", 404);
      if (["duplicate", "posted", "rejected"].includes(row.matching_status)) return fail("This invoice is a duplicate or has already been processed", 409);
      const invoiceNumber = clean(body.invoice_number ?? row.supplier_invoice_number, 100);
      const invoiceDate = isoDate(body.invoice_date ?? row.supplier_invoice_date);
      const supplier = clean(body.supplier_name ?? row.supplier_name ?? "J.A. Russell Ltd", 200);
      const reference = clean(body.purchase_order_reference ?? row.purchase_order_reference, 200);
      let extraction = {};
      try { extraction = JSON.parse(row.extraction_json || "{}"); } catch {}
      const documentType = body.document_type === "credit_note" || extraction.document_type === "credit_note" ? "credit_note" : "invoice";
      const sign = documentType === "credit_note" ? -1 : 1;
      const billable = body.billable_to_customer === undefined ? documentType === "invoice" : body.billable_to_customer === true || body.billable_to_customer === "true" || body.billable_to_customer === 1;
      const materialStatus = new Set(["normal", "credit", "return", "stock", "warranty", "non_billable"]).has(body.material_status)
        ? body.material_status : (documentType === "credit_note" ? "credit" : billable ? "normal" : "non_billable");
      const rawSubtotal = money(body.subtotal_ex_gst ?? row.subtotal_ex_gst);
      const rawGst = money(body.gst_amount ?? row.gst_amount);
      const rawTotal = money(body.total_incl_gst ?? row.total_incl_gst);
      const rawAllowableGst = money(body.allowable_input_gst ?? row.allowable_input_gst ?? rawGst);
      const subtotal = money(sign * rawSubtotal), gst = money(sign * rawGst), total = money(sign * rawTotal);
      const allowableGst = money(sign * rawAllowableGst);
      const jobId = Number(body.job_id);
      if (!invoiceNumber || !invoiceDate || !supplier || !Number.isInteger(jobId) || jobId <= 0) return fail("Confirm supplier, invoice number/date and the matching job");
      if (!supplierInvoiceAmountsReconcile(rawSubtotal, rawGst, rawTotal, rawAllowableGst)) return fail("Check the ex-GST, GST, total and allowable input GST amounts");
      const duplicateRows = await db.prepare(`SELECT id, supplier_name, supplier_invoice_number FROM bookkeeping_supplier_invoice_inbox
        WHERE book_id = ? AND id != ? AND matching_status != 'rejected' AND duplicate_of_id IS NULL`)
        .bind(bookId, id).all();
      const duplicate = (duplicateRows.results || []).find(item => supplierInvoiceDuplicate(item, {
        book_id: bookId, supplier_name: supplier, supplier_invoice_number: invoiceNumber
      }));
      if (duplicate) {
        await db.prepare("UPDATE bookkeeping_supplier_invoice_inbox SET matching_status = 'duplicate', duplicate_of_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(duplicate.id, id).run();
        return fail("This supplier invoice number has already been received for this book", 409);
      }
      const assignedBook = await db.prepare("SELECT book_id FROM bookkeeping_job_books WHERE job_id = ?").bind(jobId).first();
      if (assignedBook && assignedBook.book_id !== bookId) return fail("This job is assigned to a different business book", 409);
      const job = await db.prepare("SELECT j.id FROM jobs j JOIN enquiries e ON e.id = j.enquiry_id WHERE j.id = ?").bind(jobId).first();
      if (!job) return fail("Choose an existing Job Hub job");
      const costing = await db.prepare("SELECT default_markup_percent FROM costing_options WHERE job_id = ? ORDER BY updated_at DESC LIMIT 1").bind(jobId).first();
      const configuredMarkup = costing ? Number(costing.default_markup_percent) : 30;
      const book = await db.prepare("SELECT * FROM bookkeeping_books WHERE id = ? AND active = 1").bind(bookId).first();
      if (!book) return fail("Book not found", 404);
      if (!book.commencement_date || book.gst_basis === "unconfigured") return fail("Set this book's commencement date and accountant-confirmed GST basis before posting bills", 409);
      if (Math.abs(allowableGst) > 0 && !book.gst_registered) return fail("This book is not marked GST registered; set allowable input GST to $0 or correct the book GST setting", 409);
      const existingTx = await db.prepare(`SELECT id FROM bookkeeping_transactions WHERE book_id = ? AND source_type = 'supplier_invoice_inbox' AND source_id = ?`).bind(bookId, id).first();
      if (existingTx) return fail("This invoice already has a bookkeeping transaction", 409);

      const priorJobFile = await db.prepare("SELECT id, job_id FROM job_files WHERE storage_key = ?").bind(row.storage_key).first();
      if (priorJobFile && Number(priorJobFile.job_id) !== jobId) return fail("This source document is already attached to a different job", 409);
      const priorMaterials = await db.prepare(`SELECT id FROM job_materials WHERE job_id = ? AND invoice_number = ? AND supplier_name = ? LIMIT 1`)
        .bind(jobId, invoiceNumber, supplier).first();
      const fileId = row.job_file_id || priorJobFile?.id || crypto.randomUUID();
      const transactionId = crypto.randomUUID();
      const journalId = crypto.randomUUID();
      const historical = invoiceDate < book.commencement_date;
      const postings = [db.prepare(`INSERT INTO job_files
        (id, job_id, storage_key, original_name, content_type, size_bytes, category, caption, document_role)
        VALUES (?, ?, ?, ?, 'application/pdf', ?, 'supplier', ?, 'supplier_invoice')
        ON CONFLICT(storage_key) DO NOTHING`)
        .bind(fileId, jobId, row.storage_key, row.attachment_name, row.size_bytes,
          `${supplier} ${documentType === "credit_note" ? "credit note" : "invoice"} ${invoiceNumber}`),
      ...(!priorMaterials ? [db.prepare(`INSERT INTO job_materials
        (id, job_id, source, supplier_name, invoice_number, invoice_date, invoice_file_id,
         description, quantity, unit_code, unit_cost_ex_gst, billable_to_customer, customer_markup_percent,
         material_status, supplier_invoice_inbox_id)
        VALUES (?, ?, 'supplier_invoice', ?, ?, ?, ?, ?, 1, 'invoice', ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), jobId, supplier, invoiceNumber, invoiceDate, fileId,
          `${supplier} invoice total`, subtotal, billable ? 1 : 0, Number.isFinite(configuredMarkup) ? Math.max(0, configuredMarkup) : 30,
          materialStatus, id)] : []),
      db.prepare(`INSERT INTO bookkeeping_job_books (job_id, book_id, assigned_by)
        VALUES (?, ?, ?) ON CONFLICT(job_id) DO NOTHING`)
        .bind(jobId, bookId, clean(body.actor || "Job Hub user", 160)),
      db.prepare(`INSERT INTO bookkeeping_transactions
        (id, book_id, job_id, kind, transaction_date, reference_number, contact_name, description,
         account_id, status, reconciliation_status, gst_treatment, ex_gst_amount, gst_amount,
         allowable_input_gst, total_incl_gst, historical, source_type, source_id, supporting_file_id,
         metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unreconciled', ?, ?, ?, ?, ?, ?, 'supplier_invoice_inbox', ?, ?, ?)`) 
        .bind(transactionId, bookId, jobId, documentType === "credit_note" ? "adjustment" : "supplier_bill", invoiceDate, invoiceNumber, supplier,
          `${supplier} supplier ${documentType === "credit_note" ? "credit note" : "invoice"}`, null, historical ? "historical" : "unpaid", "standard",
          subtotal, gst, allowableGst, total, historical ? 1 : 0, id, fileId,
          JSON.stringify({ purchase_order_reference: reference, document_type: documentType, source: row.source_type, attachment_sha256: row.content_sha256 })),
      db.prepare(`UPDATE bookkeeping_supplier_invoice_inbox SET supplier_name = ?, supplier_invoice_number = ?,
        supplier_invoice_date = ?, purchase_order_reference = ?, subtotal_ex_gst = ?, gst_amount = ?,
        total_incl_gst = ?, allowable_input_gst = ?, job_id = ?, job_file_id = ?,
        accounting_transaction_id = ?, matching_status = 'posted', user_confirmed = 1,
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND book_id = ?`)
        .bind(supplier, invoiceNumber, invoiceDate, reference || null, subtotal, gst, total,
          allowableGst, jobId, fileId, transactionId, id, bookId),
      db.prepare(`INSERT INTO bookkeeping_supplier_invoice_events
        (id, book_id, inbox_id, action, actor, details_json) VALUES (?, ?, ?, 'approved_and_posted', ?, ?)`)
        .bind(crypto.randomUUID(), bookId, id, clean(body.actor || "Job Hub user", 160),
          JSON.stringify({ job_id: jobId, invoice_number: invoiceNumber, document_type: documentType, ex_gst: subtotal, gst, total, allowable_input_gst: allowableGst, historical }))];

      if (!historical) {
        const materialAccount = await db.prepare("SELECT id FROM bookkeeping_accounts WHERE book_id = ? AND code = '5000' AND is_active = 1").bind(bookId).first();
        const gstAccount = await db.prepare("SELECT id FROM bookkeeping_accounts WHERE book_id = ? AND code = '2210' AND is_active = 1").bind(bookId).first();
        const payableAccount = await db.prepare("SELECT id FROM bookkeeping_accounts WHERE book_id = ? AND code = '2000' AND is_active = 1").bind(bookId).first();
        if (!materialAccount || !payableAccount || (allowableGst && !gstAccount)) return fail("The book's materials, GST receivable or accounts payable accounts are missing", 409);
        const nonclaimable = money(Math.abs(gst - allowableGst));
        const expenseAmount = money(Math.abs(subtotal) + nonclaimable);
        const gstAmount = Math.abs(allowableGst);
        const payableAmount = Math.abs(total);
        const creditNote = documentType === "credit_note";
        postings.push(db.prepare(`INSERT INTO bookkeeping_journals
          (id, book_id, transaction_id, journal_date, reference_number, description, source, posted)
          VALUES (?, ?, ?, ?, ?, ?, 'supplier_invoice_inbox', 1)`)
          .bind(journalId, bookId, transactionId, invoiceDate, invoiceNumber, `${supplier} ${creditNote ? "credit note" : "invoice"} ${invoiceNumber}`));
        postings.push(db.prepare(`INSERT INTO bookkeeping_journal_lines
          (id, journal_id, account_id, description, debit, credit, ex_gst_amount, gst_amount,
           total_incl_gst, gst_treatment, contact_name, job_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) 
          .bind(crypto.randomUUID(), journalId, materialAccount.id, `${supplier} materials`, creditNote ? 0 : expenseAmount, creditNote ? expenseAmount : 0, creditNote ? -expenseAmount : expenseAmount, creditNote ? -nonclaimable : nonclaimable, creditNote ? -expenseAmount : expenseAmount, allowableGst ? "standard" : "non_reclaimable", supplier, jobId));
        if (allowableGst) postings.push(db.prepare(`INSERT INTO bookkeeping_journal_lines
          (id, journal_id, account_id, description, debit, credit, ex_gst_amount, gst_amount,
           total_incl_gst, gst_treatment, contact_name, job_id)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'input_gst', ?, ?)`) 
          .bind(crypto.randomUUID(), journalId, gstAccount.id, `${supplier} input GST`, creditNote ? 0 : gstAmount, creditNote ? gstAmount : 0, creditNote ? -gstAmount : gstAmount, creditNote ? -gstAmount : gstAmount, supplier, jobId));
        postings.push(db.prepare(`INSERT INTO bookkeeping_journal_lines
          (id, journal_id, account_id, description, debit, credit, ex_gst_amount, gst_amount,
           total_incl_gst, gst_treatment, contact_name, job_id)
          VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 'no_gst', ?, ?)`) 
          .bind(crypto.randomUUID(), journalId, payableAccount.id, `${supplier} accounts payable`, creditNote ? payableAmount : 0, creditNote ? 0 : payableAmount, creditNote ? -payableAmount : payableAmount, supplier, jobId));
        if (allowableGst && book.gst_basis === "invoice") postings.push(db.prepare(`INSERT INTO bookkeeping_tax_events
          (id, book_id, tax_type, event_type, transaction_id, event_date, reference_number,
           description, amount, metadata_json)
          VALUES (?, ?, 'gst', 'adjustment', ?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), bookId, transactionId, invoiceDate, invoiceNumber,
            "Allowable input GST from supplier bill", -allowableGst,
            JSON.stringify({ basis: book.gst_basis, supplier: supplier, source_inbox_id: id })));
      }
      postings.push(db.prepare(`INSERT INTO bookkeeping_audit_events
        (id, book_id, transaction_id, entity_type, entity_id, action, actor, after_json)
        VALUES (?, ?, ?, 'supplier_bill', ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), bookId, transactionId, transactionId,
          historical ? "historical_supplier_bill_recorded" : "supplier_bill_posted", clean(body.actor || "Job Hub user", 160),
          JSON.stringify({ source_inbox_id: id, job_id: jobId, invoice_number: invoiceNumber, ex_gst: subtotal, gst, total, allowable_input_gst: allowableGst, historical })));
      await db.batch(postings);
      return Response.json({ ok: true, transaction_id: transactionId, job_id: jobId, historical, posted_to_ledger: !historical });
    }

    if (body.action === "reject") {
      const id = clean(body.inbox_id, 100), bookId = clean(body.book_id, 100);
      const result = await db.prepare(`UPDATE bookkeeping_supplier_invoice_inbox SET matching_status = 'rejected', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND book_id = ? AND matching_status NOT IN ('posted','duplicate')`).bind(id, bookId).run();
      if (!(result.meta?.changes > 0)) return fail("Invoice not found or already processed", 409);
      return Response.json({ ok: true });
    }
    return fail("Unsupported supplier invoice inbox action");
  } catch (error) {
    console.error("Supplier invoice inbox POST error:", error);
    const message = error.message || "";
    const status = /unique constraint/i.test(message) ? 409 : 500;
    return fail(status === 409 ? "This invoice or attachment has already been received" : "Unable to process supplier invoice", status);
  }
}
