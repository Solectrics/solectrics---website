import { assertAccountingDateOpen } from "./bookkeeping-controls.js";

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function parseSnapshot(row) {
  try { return JSON.parse(row.snapshot_json || "{}"); } catch { return {}; }
}

export async function postIssuedCustomerInvoiceToBook(db, invoiceId, actor = "Job Hub user") {
  const invoice = await db.prepare(`SELECT id, job_id, status, snapshot_json, issued_at
    FROM customer_invoice_versions WHERE id = ?`).bind(invoiceId).first();
  if (!invoice) return { posted: false, reason: "invoice_not_found" };
  if (invoice.status !== "issued" && invoice.status !== "paid") return { posted: false, reason: "invoice_not_issued" };

  const existing = await db.prepare(`SELECT id, book_id, status FROM bookkeeping_transactions
    WHERE source_type = 'customer_invoice' AND source_id = ? LIMIT 1`).bind(invoiceId).first();
  if (existing) return { posted: true, transaction_id: existing.id, book_id: existing.book_id, existing: true };

  const assignment = await db.prepare(`SELECT jb.book_id, b.gst_registered, b.gst_basis, b.commencement_date
    FROM bookkeeping_job_books jb
    JOIN bookkeeping_books b ON b.id = jb.book_id AND b.active = 1
    WHERE jb.job_id = ? LIMIT 1`).bind(invoice.job_id).first();
  if (!assignment) return { posted: false, reason: "job_has_no_book" };
  if (!assignment.commencement_date || assignment.gst_basis === "unconfigured") {
    return { posted: false, reason: "book_not_accounting_ready", book_id: assignment.book_id };
  }

  const snapshot = parseSnapshot(invoice);
  const subtotal = money(snapshot?.totals?.subtotal_ex_gst);
  const gst = money(snapshot?.totals?.gst);
  const total = money(snapshot?.totals?.total_incl_gst);
  if (total <= 0 || money(subtotal + gst) !== total) return { posted: false, reason: "invoice_totals_invalid" };
  if (gst && !assignment.gst_registered) return { posted: false, reason: "book_not_gst_registered", book_id: assignment.book_id };

  const accounts = await db.prepare(`SELECT code, id FROM bookkeeping_accounts
    WHERE book_id = ? AND code IN ('1100','2200','4000') AND is_active = 1`)
    .bind(assignment.book_id).all();
  const byCode = new Map((accounts.results || []).map(row => [row.code, row.id]));
  if (!byCode.get("1100") || !byCode.get("4000") || (gst && !byCode.get("2200"))) {
    return { posted: false, reason: "required_accounts_missing", book_id: assignment.book_id };
  }

  const transactionId = crypto.randomUUID();
  const journalId = crypto.randomUUID();
  const issueDate = snapshot.issue_date || String(invoice.issued_at || "").slice(0, 10) || new Date().toISOString().slice(0,10);
  await assertAccountingDateOpen(db, assignment.book_id, issueDate);
  const statements = [
    db.prepare(`INSERT INTO bookkeeping_transactions
      (id, book_id, job_id, kind, transaction_date, due_date, reference_number, contact_name,
       description, status, reconciliation_status, gst_treatment, ex_gst_amount, gst_amount,
       total_incl_gst, historical, source_type, source_id, metadata_json)
      VALUES (?, ?, ?, 'sales_invoice', ?, ?, ?, ?, ?, 'unpaid', 'unreconciled', ?, ?, ?, ?, 0,
              'customer_invoice', ?, ?)`)
      .bind(transactionId, assignment.book_id, invoice.job_id, issueDate, snapshot.due_date || null,
        snapshot.invoice_number || null, snapshot?.customer?.name || null,
        `Customer invoice ${snapshot.invoice_number || invoiceId}`, gst ? "standard" : "no_gst",
        subtotal, gst, total, invoiceId, JSON.stringify({ invoice_version_id: invoiceId })),
    db.prepare(`INSERT INTO bookkeeping_journals
      (id, book_id, transaction_id, journal_date, reference_number, description, source, posted)
      VALUES (?, ?, ?, ?, ?, ?, 'customer_invoice', 1)`)
      .bind(journalId, assignment.book_id, transactionId, issueDate, snapshot.invoice_number || null,
        `Customer invoice ${snapshot.invoice_number || invoiceId}`),
    db.prepare(`INSERT INTO bookkeeping_journal_lines
      (id, journal_id, account_id, description, debit, credit, ex_gst_amount, gst_amount,
       total_incl_gst, gst_treatment, contact_name, job_id)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), journalId, byCode.get("1100"), "Accounts receivable", total,
        subtotal, gst, total, gst ? "standard" : "no_gst", snapshot?.customer?.name || null, invoice.job_id),
    db.prepare(`INSERT INTO bookkeeping_journal_lines
      (id, journal_id, account_id, description, debit, credit, ex_gst_amount, gst_amount,
       total_incl_gst, gst_treatment, contact_name, job_id)
      VALUES (?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), journalId, byCode.get("4000"), "Sales revenue", subtotal,
        subtotal, subtotal, gst ? "output_gst" : "no_gst", snapshot?.customer?.name || null, invoice.job_id),
    db.prepare(`INSERT INTO bookkeeping_audit_events
      (id, book_id, transaction_id, entity_type, entity_id, action, actor, after_json)
      VALUES (?, ?, ?, 'sales_invoice', ?, 'customer_invoice_posted', ?, ?)`)
      .bind(crypto.randomUUID(), assignment.book_id, transactionId, transactionId, String(actor || "Job Hub user").slice(0,160),
        JSON.stringify({ source_invoice_id: invoiceId, job_id: invoice.job_id, subtotal, gst, total }))
  ];
  if (gst) {
    statements.push(db.prepare(`INSERT INTO bookkeeping_journal_lines
      (id, journal_id, account_id, description, debit, credit, ex_gst_amount, gst_amount,
       total_incl_gst, gst_treatment, contact_name, job_id)
      VALUES (?, ?, ?, 'GST payable', 0, ?, 0, ?, ?, 'output_gst', ?, ?)`)
      .bind(crypto.randomUUID(), journalId, byCode.get("2200"), gst, gst, gst, snapshot?.customer?.name || null, invoice.job_id));
    if (assignment.gst_basis === "invoice" || assignment.gst_basis === "hybrid") {
      statements.push(db.prepare(`INSERT INTO bookkeeping_tax_events
        (id, book_id, tax_type, event_type, transaction_id, event_date, reference_number,
         description, amount, metadata_json)
        VALUES (?, ?, 'gst', 'liability', ?, ?, ?, 'Output GST from issued customer invoice', ?, ?)`)
        .bind(crypto.randomUUID(), assignment.book_id, transactionId, issueDate, snapshot.invoice_number || null,
          gst, JSON.stringify({ basis: assignment.gst_basis, source_invoice_id: invoiceId })));
    }
  }
  await db.batch(statements);
  return { posted: true, transaction_id: transactionId, book_id: assignment.book_id, existing: false };
}
