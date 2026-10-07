import { calculateBalanceSheet, calculateProfitAndLoss, calculateTrialBalance, toMappedCsv, validateJournalLines } from "./bookkeeping-core.js";
import { assertAccountingDateOpen } from "./bookkeeping-controls.js";

function fail(error, status = 400) {
  return Response.json({ ok: false, error }, { status });
}

function safeDate(value) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

async function loadBook(context, bookId) {
  return context.env.DB.prepare("SELECT * FROM bookkeeping_books WHERE id = ? AND active = 1").bind(bookId).first();
}

async function loadLedger(db, bookId, { from, to, asAt, allTime = false } = {}) {
  let sql = `
    SELECT l.id, j.id AS journal_id, j.journal_date, j.reference_number AS journal_reference,
           j.description AS journal_description, j.source, t.id AS transaction_id, t.kind,
           t.reference_number AS transaction_reference, t.contact_name, t.description,
           t.gst_treatment, t.status, t.reconciliation_status, a.id AS account_id,
           a.code AS account_code, a.name AS account_name, a.account_type,
           l.description AS line_description, l.debit, l.credit, l.ex_gst_amount,
           l.gst_amount, l.total_incl_gst, l.gst_treatment AS line_gst_treatment,
           l.contact_name AS line_contact_name, l.job_id
    FROM bookkeeping_journal_lines l
    JOIN bookkeeping_journals j ON j.id = l.journal_id AND j.posted = 1
    JOIN bookkeeping_accounts a ON a.id = l.account_id AND a.book_id = j.book_id
    LEFT JOIN bookkeeping_transactions t ON t.id = j.transaction_id
    WHERE j.book_id = ?`;
  const binds = [bookId];
  if (!allTime && from) { sql += " AND j.journal_date >= ?"; binds.push(from); }
  if (to) sql += " AND j.journal_date <= ?", binds.push(to);
  if (asAt) sql += " AND j.journal_date <= ?", binds.push(asAt);
  sql += " ORDER BY j.journal_date, j.created_at, l.id";
  const result = await db.prepare(sql).bind(...binds).all();
  return result.results || [];
}

function mapTrialRow(row) {
  return {
    account_code: row.code, account_name: row.name, account_type: row.account_type,
    debit: row.debit, credit: row.credit, balance: row.balance
  };
}

function flattenJournal(rows) {
  return rows.map(row => ({
    transaction_date: row.journal_date,
    invoice_reference: row.transaction_reference || row.journal_reference || "",
    contact: row.line_contact_name || row.contact_name || "",
    description: row.line_description || row.description || row.journal_description || "",
    account_code: row.account_code,
    account: row.account_name,
    debit: Number(row.debit) || 0,
    credit: Number(row.credit) || 0,
    ex_gst_amount: Number(row.ex_gst_amount) || 0,
    gst_amount: Number(row.gst_amount) || 0,
    gst_inclusive_amount: Number(row.total_incl_gst) || 0,
    gst_treatment: row.line_gst_treatment || row.gst_treatment || "no_gst",
    payment_status: row.status || "posted",
    reconciliation_status: row.reconciliation_status || "unreconciled",
    job_id: row.job_id || ""
  }));
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    if (!db) return fail("D1 database binding DB is not available", 500);
    const url = new URL(context.request.url);
    const view = url.searchParams.get("view") || "books";
    if (view === "books") {
      const rows = await db.prepare("SELECT id, name, legal_name, currency, gst_registered, gst_basis, commencement_date, historical_label, company_tax_rate, company_tax_enabled FROM bookkeeping_books WHERE active = 1 ORDER BY name").all();
      return Response.json({ ok: true, books: rows.results || [] });
    }
    const bookId = String(url.searchParams.get("book_id") || "").trim();
    if (!bookId) return fail("book_id is required");
    const book = await loadBook(context, bookId);
    if (!book) return fail("Book not found", 404);
    if (view === "accounts") {
      const rows = await db.prepare("SELECT id, code, name, account_type, tax_code, is_control, is_active FROM bookkeeping_accounts WHERE book_id = ? ORDER BY code").bind(bookId).all();
      return Response.json({ ok: true, book: { id: book.id, name: book.name }, accounts: rows.results || [] });
    }

    const from = safeDate(url.searchParams.get("from"));
    const to = safeDate(url.searchParams.get("to"));
    const asAt = safeDate(url.searchParams.get("as_at"));
    if (url.searchParams.has("from") && !from) return fail("from must use YYYY-MM-DD");
    if (url.searchParams.has("to") && !to) return fail("to must use YYYY-MM-DD");
    if (url.searchParams.has("as_at") && !asAt) return fail("as_at must use YYYY-MM-DD");
    const accountsResult = await db.prepare("SELECT id, code, name, account_type, tax_code FROM bookkeeping_accounts WHERE book_id = ? AND is_active = 1 ORDER BY code").bind(bookId).all();
    const accounts = accountsResult.results || [];
    const ledger = await loadLedger(db, bookId, view === "balance_sheet" || view === "trial_balance" ? { asAt, allTime: true } : { from, to });
    const fields = ["transaction_date", "invoice_reference", "contact", "description", "account_code", "account", "debit", "credit", "ex_gst_amount", "gst_amount", "gst_inclusive_amount", "gst_treatment", "payment_status", "reconciliation_status", "job_id"];
    const exportType = view;
    const mappingRow = await db.prepare("SELECT field_mapping_json FROM bookkeeping_export_mappings WHERE book_id = ? AND export_type = ? AND is_default = 1 ORDER BY updated_at DESC LIMIT 1").bind(bookId, exportType).first();
    let mapping = {};
    try { mapping = mappingRow ? JSON.parse(mappingRow.field_mapping_json) : {}; } catch { mapping = {}; }

    if (view === "general_ledger") {
      const rows = flattenJournal(ledger);
      if (url.searchParams.get("format") === "csv") return new Response(toMappedCsv(rows, fields, mapping), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=general-ledger.csv" } });
      return Response.json({ ok: true, book: { id: book.id, name: book.name }, period: { from, to }, transactions: rows });
    }
    if (view === "trial_balance") {
      const report = calculateTrialBalance(accounts, ledger);
      if (url.searchParams.get("format") === "csv") return new Response(toMappedCsv(report.rows.map(mapTrialRow), ["account_code", "account_name", "account_type", "debit", "credit", "balance"], mapping), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=trial-balance.csv" } });
      return Response.json({ ok: true, report: "trial_balance", as_at: asAt, ...report });
    }
    if (view === "profit_and_loss") {
      const report = calculateProfitAndLoss(accounts, ledger);
      if (url.searchParams.get("format") === "csv") return new Response(toMappedCsv(report.rows, ["code", "name", "account_type", "amount"], mapping), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=profit-and-loss.csv" } });
      return Response.json({ ok: true, report: "profit_and_loss", period: { from, to }, ...report });
    }
    if (view === "balance_sheet") {
      const pnlLedger = await loadLedger(db, bookId, { to: asAt });
      const pnl = calculateProfitAndLoss(accounts, pnlLedger);
      const report = calculateBalanceSheet(accounts, ledger, pnl);
      if (url.searchParams.get("format") === "csv") return new Response(toMappedCsv(report.rows, ["code", "name", "account_type", "amount"], mapping), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=balance-sheet.csv" } });
      return Response.json({ ok: true, report: "balance_sheet", as_at: asAt, ...report });
    }
    return fail("Unsupported bookkeeping view");
  } catch (error) {
    console.error("Bookkeeping report error:", error);
    return fail("Unable to load bookkeeping data", 500);
  }
}

const STANDARD_ACCOUNTS = [
  ["1000", "Bank accounts", "asset", "no_gst", 1],
  ["1100", "Accounts receivable", "asset", "no_gst", 1],
  ["1200", "Inventory", "asset", "input_gst", 0],
  ["1500", "Property, plant and equipment", "asset", "input_gst", 0],
  ["1590", "Accumulated depreciation", "asset", "no_gst", 0],
  ["2000", "Accounts payable", "liability", "no_gst", 1],
  ["2200", "GST payable", "liability", "no_gst", 1],
  ["2210", "GST receivable", "asset", "no_gst", 1],
  ["2300", "PAYE payable", "liability", "no_gst", 1],
  ["2310", "Other payroll deductions payable", "liability", "no_gst", 1],
  ["2400", "Company income tax payable", "liability", "no_gst", 1],
  ["3000", "Owner/shareholder equity", "equity", "no_gst", 0],
  ["3100", "Owner/shareholder current account", "equity", "no_gst", 0],
  ["3200", "Retained earnings", "equity", "no_gst", 0],
  ["4000", "Sales revenue", "income", "output_gst", 0],
  ["4100", "Other income", "income", "output_gst", 0],
  ["5000", "Materials and goods for resale", "expense", "input_gst", 0],
  ["5100", "Subcontractor costs", "expense", "input_gst", 0],
  ["5200", "Employee wages", "expense", "no_gst", 0],
  ["5300", "Supervision and compliance costs", "expense", "input_gst", 0],
  ["5400", "Inspection costs", "expense", "input_gst", 0],
  ["5500", "Vehicle and travel", "expense", "input_gst", 0],
  ["5600", "Office and administration", "expense", "input_gst", 0],
  ["5700", "Other operating expenses", "expense", "input_gst", 0],
  ["5800", "Depreciation expense", "expense", "no_gst", 0]
];

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) return fail("D1 database binding DB is not available", 500);
    const body = await context.request.json();
    if (body.action === "post_journal") {
      const bookId = String(body.book_id || "").trim();
      if (!bookId || !(await loadBook(context, bookId))) return fail("A valid book_id is required");
      const transaction = body.transaction || {};
      const journal = body.journal || {};
      const lines = body.lines || [];
      const validKinds = new Set(["sales_invoice", "supplier_bill", "expense", "payment_received", "payment_made", "tax_payment", "payroll_liability", "shareholder_transaction", "fixed_asset", "opening_balance", "adjustment"]);
      const date = safeDate(transaction.transaction_date);
      if (!validKinds.has(transaction.kind) || !date) return fail("Transaction kind and a valid transaction_date are required");
      await assertAccountingDateOpen(db, bookId, date);
      const reference = String(transaction.reference_number || "").trim().slice(0, 100) || null;
      const contactName = String(transaction.contact_name || "").trim().slice(0, 200) || null;
      const description = String(transaction.description || "").trim().slice(0, 1000);
      const exGst = Number(transaction.ex_gst_amount || 0);
      const gst = Number(transaction.gst_amount || 0);
      const inclusive = Number(transaction.total_incl_gst || 0);
      if (![exGst, gst, inclusive].every(Number.isFinite) || Math.abs(exGst + gst - inclusive) > 0.011) return fail("Ex-GST, GST and GST-inclusive amounts must add up");
      const balance = validateJournalLines(lines);
      if (!balance.ok) return fail(balance.error);
      const accountIds = [...new Set(lines.map(line => String(line.account_id || "")))];
      const accountRows = await db.prepare(`SELECT id FROM bookkeeping_accounts WHERE book_id = ? AND is_active = 1 AND id IN (${accountIds.map(() => "?").join(",")})`).bind(bookId, ...accountIds).all();
      if ((accountRows.results || []).length !== accountIds.length) return fail("Every journal line must use an active account from this book");
      const transactionId = crypto.randomUUID();
      const journalId = crypto.randomUUID();
      const dueDate = transaction.due_date ? safeDate(transaction.due_date) : null;
      if (transaction.due_date && !dueDate) return fail("due_date must use YYYY-MM-DD");
      const actor = String(body.actor || "Job Hub user").trim().slice(0, 160);
      const statements = [db.prepare(`INSERT INTO bookkeeping_transactions (
        id, book_id, job_id, kind, transaction_date, due_date, reference_number, contact_name,
        description, status, payment_method, payment_reference, reconciliation_status,
        gst_treatment, ex_gst_amount, gst_amount, total_incl_gst, historical,
        source_type, source_id, supporting_file_id, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(transactionId, bookId, transaction.job_id != null && transaction.job_id !== "" && Number.isInteger(Number(transaction.job_id)) ? Number(transaction.job_id) : null,
          transaction.kind, date, dueDate, reference, contactName, description,
          String(transaction.status || "unpaid").slice(0, 30), String(transaction.payment_method || "").slice(0, 40) || null,
          String(transaction.payment_reference || "").slice(0, 100) || null,
          String(transaction.reconciliation_status || "unreconciled").slice(0, 30),
          String(transaction.gst_treatment || "no_gst").slice(0, 40), exGst, gst, inclusive,
          transaction.historical ? 1 : 0, String(transaction.source_type || "").slice(0, 50) || null,
          String(transaction.source_id || "").slice(0, 100) || null,
          String(transaction.supporting_file_id || "").slice(0, 100) || null,
          JSON.stringify(transaction.metadata || {})),
      db.prepare(`INSERT INTO bookkeeping_journals
        (id, book_id, transaction_id, journal_date, reference_number, description, source, posted)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
        .bind(journalId, bookId, transactionId, safeDate(journal.journal_date) || date,
          String(journal.reference_number || reference || "").slice(0, 100) || null,
          String(journal.description || description).slice(0, 1000), String(journal.source || "manual").slice(0, 40))];
      for (const line of lines) statements.push(db.prepare(`INSERT INTO bookkeeping_journal_lines
        (id, journal_id, account_id, description, debit, credit, ex_gst_amount, gst_amount,
         total_incl_gst, gst_treatment, contact_name, job_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), journalId, line.account_id,
          String(line.description || description).slice(0, 1000), Number(line.debit || 0), Number(line.credit || 0),
          Number(line.ex_gst_amount || 0), Number(line.gst_amount || 0), Number(line.total_incl_gst || 0),
          String(line.gst_treatment || transaction.gst_treatment || "no_gst").slice(0, 40),
          String(line.contact_name || contactName || "").slice(0, 200) || null,
          (line.job_id ?? transaction.job_id) != null && (line.job_id ?? transaction.job_id) !== "" && Number.isInteger(Number(line.job_id ?? transaction.job_id)) ? Number(line.job_id ?? transaction.job_id) : null));
      if (transaction.supporting_file_id) statements.push(db.prepare(`INSERT INTO bookkeeping_document_links
        (id, book_id, transaction_id, file_id, role) VALUES (?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), bookId, transactionId, String(transaction.supporting_file_id).slice(0, 100), String(transaction.document_role || "supporting_document").slice(0, 60)));
      statements.push(db.prepare(`INSERT INTO bookkeeping_audit_events
        (id, book_id, transaction_id, entity_type, entity_id, action, actor, after_json)
        VALUES (?, ?, ?, 'transaction', ?, 'created_and_posted', ?, ?)`)
        .bind(crypto.randomUUID(), bookId, transactionId, transactionId, actor, JSON.stringify({ transaction, journal, lines })));
      await db.batch(statements);
      return Response.json({ ok: true, transaction_id: transactionId, journal_id: journalId, debits: balance.debits, credits: balance.credits }, { status: 201 });
    }
    if (body.action === "save_export_mapping") {
      const bookId = String(body.book_id || "").trim();
      if (!bookId || !(await loadBook(context, bookId))) return fail("A valid book_id is required");
      const exportType = String(body.export_type || "").trim().slice(0, 60);
      const mappingName = String(body.mapping_name || "").trim().slice(0, 120);
      const mapping = body.field_mapping;
      if (!exportType || !mappingName || !mapping || typeof mapping !== "object" || Array.isArray(mapping)) return fail("export_type, mapping_name and field_mapping object are required");
      const mappingId = crypto.randomUUID();
      await db.batch([
        db.prepare("UPDATE bookkeeping_export_mappings SET is_default = 0 WHERE book_id = ? AND export_type = ?").bind(bookId, exportType),
        db.prepare(`INSERT INTO bookkeeping_export_mappings (id, book_id, export_type, mapping_name, field_mapping_json, is_default)
          VALUES (?, ?, ?, ?, ?, 1)
          ON CONFLICT(book_id, export_type, mapping_name) DO UPDATE SET field_mapping_json = excluded.field_mapping_json, is_default = 1, updated_at = CURRENT_TIMESTAMP`)
          .bind(mappingId, bookId, exportType, mappingName, JSON.stringify(mapping)),
        db.prepare(`INSERT INTO bookkeeping_audit_events (id, book_id, entity_type, entity_id, action, after_json)
          VALUES (?, ?, 'export_mapping', ?, 'saved', ?)`)
          .bind(crypto.randomUUID(), bookId, `${exportType}:${mappingName}`, JSON.stringify(mapping))
      ]);
      return Response.json({ ok: true, mapping_name: mappingName });
    }
    if (body.action !== "create_book") return fail("Unsupported bookkeeping action");
    const name = String(body.name || "").trim().slice(0, 120);
    const legalName = String(body.legal_name || "").trim().slice(0, 160) || null;
    const gstBasis = String(body.gst_basis || "unconfigured");
    const commencementDate = body.commencement_date == null || body.commencement_date === "" ? null : safeDate(body.commencement_date);
    if (!name) return fail("Book name is required");
    if (!commencementDate && body.commencement_date) return fail("commencement_date must use YYYY-MM-DD");
    if (!["payments", "invoice", "hybrid", "unconfigured"].includes(gstBasis)) return fail("GST basis must be payments, invoice, hybrid, or unconfigured");
    const companyTaxRate = Number(body.company_tax_rate ?? 0.28);
    const gstRate = Number(body.gst_rate ?? 0.15);
    if (!Number.isFinite(companyTaxRate) || companyTaxRate < 0 || companyTaxRate > 1) return fail("Company tax rate must be between 0 and 1");
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 1) return fail("GST rate must be between 0 and 1");
    const id = crypto.randomUUID();
    const statements = [db.prepare(`
      INSERT INTO bookkeeping_books (
        id, name, legal_name, currency, gst_registered, gst_number, gst_basis, gst_rate,
        commencement_date, company_tax_rate, company_tax_enabled, settings_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, name, legalName, String(body.currency || "NZD").slice(0, 3), body.gst_registered ? 1 : 0,
      String(body.gst_number || "").trim().slice(0, 40) || null, gstBasis, gstRate, commencementDate,
      companyTaxRate, body.company_tax_enabled ? 1 : 0, JSON.stringify({
        business_email: String(body.business_email || "").trim().slice(0, 200),
        payment_terms_days: Number(body.payment_terms_days) || 7,
        invoice_prefix: String(body.invoice_prefix || "INV").trim().slice(0, 12),
        tax_profile_status: String(body.tax_profile_status || "unconfirmed").slice(0, 40)
      }))];
    for (const [code, accountName, type, taxCode, control] of STANDARD_ACCOUNTS) {
      statements.push(db.prepare(`INSERT INTO bookkeeping_accounts (id, book_id, code, name, account_type, tax_code, is_control)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), id, code, accountName, type, taxCode, control));
    }
    statements.push(db.prepare(`INSERT INTO bookkeeping_audit_events
      (id, book_id, entity_type, entity_id, action, after_json)
      VALUES (?, ?, 'book', ?, 'created', ?)`)
      .bind(crypto.randomUUID(), id, id, JSON.stringify({ name, legal_name: legalName, gst_basis: gstBasis, commencement_date: commencementDate })));
    await db.batch(statements);
    return Response.json({ ok: true, book: { id, name, legal_name: legalName, gst_basis: gstBasis, commencement_date: commencementDate }, accounts_created: STANDARD_ACCOUNTS.length }, { status: 201 });
  } catch (error) {
    console.error("Bookkeeping book creation error:", error);
    const conflict = String(error.message || "").toLowerCase().includes("unique");
    return fail(conflict ? "A book with that configuration already exists" : "Unable to create bookkeeping book", conflict ? 409 : 500);
  }
}
