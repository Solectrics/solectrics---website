import { normalizeBankFeedRows, buildImportFingerprint } from "./bank-feed-adapters.js";
import { rankReconciliationCandidates, decideReconciliationMatch, remainingBalance } from "./bank-reconciliation-core.js";

function responseError(message, status = 400) { return Response.json({ ok: false, error: message }, { status }); }
function amount(value) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100; }
function clean(value, limit = 500) { return String(value ?? "").trim().slice(0, limit); }
function validDate(value) { const text = clean(value, 10); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null; }
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function loadBook(db, bookId) {
  return db.prepare("SELECT id, gst_basis FROM bookkeeping_books WHERE id = ? AND active = 1").bind(bookId).first();
}

async function outstandingTransactions(db, bookId, direction) {
  const kind = direction === "inflow" ? "sales_invoice" : "supplier_bill";
  const rows = await db.prepare(`
    SELECT t.id, t.kind, t.transaction_date, t.due_date, t.reference_number,
           t.contact_name, t.description, t.total_incl_gst, t.gst_amount,
           t.allowable_input_gst, t.gst_treatment, t.status, t.job_id,
           t.source_type, t.source_id,
           COALESCE((SELECT SUM(p.amount) FROM bookkeeping_payment_allocations p
             WHERE p.book_id = t.book_id AND p.invoice_transaction_id = t.id), 0) AS allocated_amount
    FROM bookkeeping_transactions t
    WHERE t.book_id = ? AND t.kind = ? AND t.historical = 0
      AND t.status IN ('unpaid','partially_paid','issued','overdue')
    ORDER BY t.due_date, t.transaction_date, t.created_at
  `).bind(bookId, kind).all();
  return (rows.results || []).map(row => ({
    ...row,
    outstanding_amount: remainingBalance(row.total_incl_gst, [row.allocated_amount])
  })).filter(row => row.outstanding_amount > 0);
}

async function candidatesFor(db, bankRow) {
  return rankReconciliationCandidates(bankRow, await outstandingTransactions(db, bankRow.book_id, bankRow.direction));
}

async function postMatch(db, bankRow, target, { method, confidence, actor }) {
  const expectedKind = bankRow.direction === "inflow" ? "sales_invoice" : "supplier_bill";
  if (!target || target.kind !== expectedKind) throw new Error("Selected transaction is not a matching open invoice or supplier bill");
  const fresh = (await outstandingTransactions(db, bankRow.book_id, bankRow.direction)).find(row => row.id === target.id);
  if (!fresh) throw new Error("Selected invoice or bill is no longer outstanding");
  if (amount(bankRow.amount) > amount(fresh.outstanding_amount)) throw new Error("Payment is greater than the outstanding amount; review or split it before matching");

  const bankAccount = await db.prepare(`SELECT id, ledger_account_id FROM bookkeeping_bank_accounts
    WHERE id = ? AND book_id = ? AND active = 1`).bind(bankRow.bank_account_id, bankRow.book_id).first();
  if (!bankAccount) throw new Error("Bank account is not active in this book");
  const controlCode = bankRow.direction === "inflow" ? "1100" : "2000";
  const control = await db.prepare(`SELECT id FROM bookkeeping_accounts WHERE book_id = ? AND code = ? AND account_type = ? AND is_active = 1`)
    .bind(bankRow.book_id, controlCode, bankRow.direction === "inflow" ? "asset" : "liability").first();
  if (!control) throw new Error(`The chart of accounts is missing control account ${controlCode}`);

  const paidAmount = amount(bankRow.amount);
  const remaining = amount(fresh.outstanding_amount - paidAmount);
  const paymentId = crypto.randomUUID();
  const journalId = crypto.randomUUID();
  const matchId = crypto.randomUUID();
  const paymentKind = bankRow.direction === "inflow" ? "payment_received" : "payment_made";
  const paymentReference = clean(bankRow.reference || bankRow.external_transaction_id || "", 100) || null;
  const paymentDescription = clean(bankRow.description || `${bankRow.direction === "inflow" ? "Receipt from" : "Payment to"} ${bankRow.counterparty || fresh.contact_name || "contact"}`, 1000);
  const cashLine = bankRow.direction === "inflow"
    ? { account_id: bankAccount.ledger_account_id, debit: paidAmount, credit: 0 }
    : { account_id: bankAccount.ledger_account_id, debit: 0, credit: paidAmount };
  const controlLine = bankRow.direction === "inflow"
    ? { account_id: control.id, debit: 0, credit: paidAmount }
    : { account_id: control.id, debit: paidAmount, credit: 0 };
  const statements = [db.prepare(`INSERT INTO bookkeeping_transactions (
    id, book_id, job_id, kind, transaction_date, reference_number, contact_name, description,
    status, payment_method, payment_reference, reconciliation_status, gst_treatment,
    ex_gst_amount, gst_amount, total_incl_gst, source_type, source_id, metadata_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid', 'bank_feed', ?, 'reconciled', 'no_gst', ?, 0, ?, 'bank_feed_transaction', ?, ?)`)
    .bind(paymentId, bankRow.book_id, fresh.job_id || null, paymentKind, bankRow.transaction_date,
      paymentReference, fresh.contact_name || bankRow.counterparty || null, paymentDescription,
      paymentReference, paidAmount, paidAmount, bankRow.id,
      JSON.stringify({ bank_account_id: bankRow.bank_account_id, bank_direction: bankRow.direction, matched_target: fresh.id }))];
  statements.push(db.prepare(`INSERT INTO bookkeeping_journals
    (id, book_id, transaction_id, journal_date, reference_number, description, source, posted)
    VALUES (?, ?, ?, ?, ?, ?, 'bank_reconciliation', 1)`)
    .bind(journalId, bankRow.book_id, paymentId, bankRow.transaction_date, paymentReference, paymentDescription));
  for (const line of [cashLine, controlLine]) statements.push(db.prepare(`INSERT INTO bookkeeping_journal_lines
    (id, journal_id, account_id, description, debit, credit, ex_gst_amount, gst_amount,
     total_incl_gst, gst_treatment, contact_name, job_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'no_gst', ?, ?)`)
    .bind(crypto.randomUUID(), journalId, line.account_id, paymentDescription, line.debit, line.credit,
      paidAmount, paidAmount, fresh.contact_name || bankRow.counterparty || null, fresh.job_id || null));
  statements.push(db.prepare(`INSERT INTO bookkeeping_payment_allocations
    (id, book_id, payment_transaction_id, invoice_transaction_id, amount)
    VALUES (?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), bankRow.book_id, paymentId, fresh.id, paidAmount));
  statements.push(db.prepare(`INSERT INTO bookkeeping_reconciliation_matches
    (id, book_id, bank_transaction_id, payment_transaction_id, target_transaction_id,
     allocated_amount, match_method, confidence_score, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(matchId, bankRow.book_id, bankRow.id, paymentId, fresh.id, paidAmount, method, confidence, actor || null));
  statements.push(db.prepare(`UPDATE bookkeeping_transactions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND book_id = ?`)
    .bind(remaining === 0 ? "paid" : "partially_paid", fresh.id, bankRow.book_id));
  if (fresh.source_type === "customer_invoice" && fresh.source_id) {
    statements.push(db.prepare(`UPDATE customer_invoice_versions SET status = ?,
      paid_at = CASE WHEN ? = 'paid' AND paid_at IS NULL THEN ? ELSE paid_at END
      WHERE id = ?`)
      .bind(remaining === 0 ? "paid" : "issued", remaining === 0 ? "paid" : "issued", `${bankRow.transaction_date}T00:00:00.000Z`, fresh.source_id));
  }
  statements.push(db.prepare(`UPDATE bookkeeping_bank_feed_transactions SET
    transaction_status = ?, reconciliation_status = 'reconciled' WHERE id = ? AND book_id = ?`)
    .bind(remaining === 0 ? "matched" : "partially_matched", bankRow.id, bankRow.book_id));
  statements.push(db.prepare(`UPDATE bookkeeping_reconciliation_reviews SET review_status = ?,
    selected_transaction_id = ?, confidence_score = ?, decision_reason = ?, decided_by = ?,
    decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE bank_transaction_id = ?`)
    .bind(method === "automatic" ? "auto_matched" : "approved", fresh.id, confidence,
      method === "automatic" ? "Unique exact reference and amount" : "Approved by user",
      actor || null, bankRow.id));
  statements.push(db.prepare(`INSERT INTO bookkeeping_audit_events
    (id, book_id, transaction_id, entity_type, entity_id, action, actor, after_json)
    VALUES (?, ?, ?, 'bank_reconciliation', ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), bankRow.book_id, paymentId, bankRow.id,
      method === "automatic" ? "automatically_matched" : "user_approved_match", actor || null,
      JSON.stringify({ target_transaction_id: fresh.id, payment_amount: paidAmount, outstanding_after: remaining })));
  statements.push(db.prepare(`INSERT INTO bookkeeping_bank_feed_audit
    (id, book_id, bank_transaction_id, action, actor, details_json)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), bankRow.book_id, bankRow.id, method === "automatic" ? "automatically_matched" : "user_approved_match",
      actor || null, JSON.stringify({ target_transaction_id: fresh.id, payment_transaction_id: paymentId, amount: paidAmount, confidence })));

  const book = await loadBook(db, bankRow.book_id);
  if (book?.gst_basis === "payments" || (book?.gst_basis === "hybrid" && bankRow.direction === "outflow")) {
    const gross = Number(fresh.total_incl_gst) || 0;
    const baseGst = bankRow.direction === "inflow" ? Number(fresh.gst_amount) || 0 : Number(fresh.allowable_input_gst) || 0;
    const recognized = gross > 0 ? amount(baseGst * (paidAmount / gross)) : 0;
    if (recognized) statements.push(db.prepare(`INSERT INTO bookkeeping_tax_events
      (id, book_id, tax_type, event_type, transaction_id, event_date, reference_number, description, amount, metadata_json)
      VALUES (?, ?, 'gst', 'adjustment', ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), bankRow.book_id, paymentId, bankRow.transaction_date, paymentReference,
        "GST recognised from matched bank payment", bankRow.direction === "inflow" ? recognized : -recognized,
        JSON.stringify({ basis: book.gst_basis, source_transaction_id: fresh.id, allocation_fraction: paidAmount / gross })));
  }

  await db.batch(statements);
  return { payment_transaction_id: paymentId, journal_id: journalId, target_transaction_id: fresh.id, amount: paidAmount, outstanding_after: remaining };
}

async function loadFeedRow(db, bookId, bankTransactionId) {
  return db.prepare(`SELECT * FROM bookkeeping_bank_feed_transactions WHERE id = ? AND book_id = ?`)
    .bind(bankTransactionId, bookId).first();
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    if (!db) return responseError("D1 database binding DB is not available", 500);
    const url = new URL(context.request.url);
    const view = url.searchParams.get("view") || "needs_matching";
    const bookId = clean(url.searchParams.get("book_id"), 100);
    if (!bookId || !(await loadBook(db, bookId))) return responseError("A valid book_id is required");
    if (view === "bank_accounts") {
      const accounts = await db.prepare(`SELECT id, account_name, provider_code, account_number_masked, currency,
        current_balance, balance_as_at FROM bookkeeping_bank_accounts WHERE book_id = ? AND active = 1 ORDER BY account_name`)
        .bind(bookId).all();
      return Response.json({ ok: true, bank_accounts: accounts.results || [] });
    }
    if (view !== "needs_matching") return responseError("Unsupported bank reconciliation view");
    const rows = await db.prepare(`SELECT b.*, r.id AS review_id, r.review_status, r.suggested_matches_json,
      r.confidence_score, r.decision_reason FROM bookkeeping_bank_feed_transactions b
      LEFT JOIN bookkeeping_reconciliation_reviews r ON r.bank_transaction_id = b.id
      WHERE b.book_id = ? AND b.transaction_status IN ('needs_matching','partially_matched')
      ORDER BY b.transaction_date, b.created_at`).bind(bookId).all();
    return Response.json({ ok: true, transactions: (rows.results || []).map(row => {
      let suggestions = [];
      try { suggestions = JSON.parse(row.suggested_matches_json || "[]"); } catch {}
      return { ...row, suggested_matches_json: undefined, suggestions };
    }) });
  } catch (error) {
    console.error("Bank reconciliation GET error:", error);
    return responseError("Unable to load bank reconciliation data", 500);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) return responseError("D1 database binding DB is not available", 500);
    const body = await context.request.json();
    const actor = clean(body.actor || "Job Hub user", 160);

    if (body.action === "create_bank_account") {
      const bookId = clean(body.book_id, 100);
      if (!bookId || !(await loadBook(db, bookId))) return responseError("A valid book_id is required");
      const ledgerAccountId = clean(body.ledger_account_id, 100);
      const ledger = await db.prepare(`SELECT id FROM bookkeeping_accounts WHERE id = ? AND book_id = ? AND account_type = 'asset' AND is_active = 1`)
        .bind(ledgerAccountId, bookId).first();
      if (!ledger) return responseError("Select an active asset account from this book");
      const accountId = crypto.randomUUID();
      await db.prepare(`INSERT INTO bookkeeping_bank_accounts
        (id, book_id, ledger_account_id, account_name, provider_code, external_account_id,
         account_number_masked, currency, settings_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(accountId, bookId, ledgerAccountId, clean(body.account_name, 120),
          clean(body.provider_code || "manual_import", 60), clean(body.external_account_id, 160) || null,
          clean(body.account_number_masked, 40) || null, clean(body.currency || "NZD", 3),
          JSON.stringify(body.settings || {})).run();
      return Response.json({ ok: true, bank_account_id: accountId }, { status: 201 });
    }

    if (body.action === "import_transactions") {
      const bookId = clean(body.book_id, 100);
      const bankAccountId = clean(body.bank_account_id, 100);
      if (!bookId || !(await loadBook(db, bookId))) return responseError("A valid book_id is required");
      const bankAccount = await db.prepare(`SELECT id FROM bookkeeping_bank_accounts WHERE id = ? AND book_id = ? AND active = 1`)
        .bind(bankAccountId, bookId).first();
      if (!bankAccount) return responseError("Select an active bank account in this book");
      let normalizedRows;
      try { normalizedRows = normalizeBankFeedRows(body.rows, body.field_mapping || {}); }
      catch (error) { return responseError(error.message); }
      if (!normalizedRows.length) return responseError("The bank feed contains no transactions");
      const fingerprint = await sha256(buildImportFingerprint(normalizedRows));
      const existingImport = await db.prepare(`SELECT id FROM bookkeeping_bank_feed_imports
        WHERE bank_account_id = ? AND import_fingerprint = ?`).bind(bankAccountId, fingerprint).first();
      if (existingImport) return Response.json({ ok: false, duplicate_import: true, import_id: existingImport.id, error: "This bank feed has already been imported" }, { status: 409 });
      const sourceType = clean(body.source_type || "manual_import", 50);
      const importId = crypto.randomUUID();
      await db.prepare(`INSERT INTO bookkeeping_bank_feed_imports
        (id, book_id, bank_account_id, source_type, source_batch_id, import_fingerprint,
         source_filename, row_count, imported_by, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(importId, bookId, bankAccountId, sourceType, clean(body.source_batch_id, 160) || null,
          fingerprint, clean(body.source_filename, 240) || null, normalizedRows.length, actor,
          JSON.stringify(body.metadata || {})).run();
      let duplicates = 0;
      const imported = [];
      for (const row of normalizedRows) {
        if (row.external_transaction_id) {
          const duplicate = await db.prepare(`SELECT id FROM bookkeeping_bank_feed_transactions
            WHERE bank_account_id = ? AND external_transaction_id = ?`).bind(bankAccountId, row.external_transaction_id).first();
          if (duplicate) { duplicates += 1; continue; }
        }
        const bankTransactionId = crypto.randomUUID();
        const bankRow = { ...row, id: bankTransactionId, book_id: bookId, bank_account_id: bankAccountId };
        const ranked = await candidatesFor(db, bankRow);
        const decision = decideReconciliationMatch(ranked);
        await db.prepare(`INSERT INTO bookkeeping_bank_feed_transactions
          (id, book_id, bank_account_id, import_id, external_transaction_id, transaction_date,
           direction, amount, currency, counterparty, reference, description, transaction_code,
           transaction_status, raw_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs_matching', ?)`)
          .bind(bankTransactionId, bookId, bankAccountId, importId, row.external_transaction_id,
            row.transaction_date, row.direction, row.amount, row.currency, row.counterparty,
            row.reference, row.description, row.transaction_code, JSON.stringify(row.raw)).run();
        await db.prepare(`INSERT INTO bookkeeping_reconciliation_reviews
          (id, book_id, bank_transaction_id, review_status, suggested_matches_json,
           confidence_score, decision_reason)
          VALUES (?, ?, ?, 'needs_matching', ?, ?, ?)`)
          .bind(crypto.randomUUID(), bookId, bankTransactionId,
            JSON.stringify(ranked.slice(0, 8)), decision.confidence_score, decision.reason).run();
        const saved = await loadFeedRow(db, bookId, bankTransactionId);
        let match = null;
        if (decision.action === "auto_match") {
          try { match = await postMatch(db, saved, decision.candidate, { method: "automatic", confidence: decision.confidence_score, actor: "Job Hub auto-match" }); }
          catch (error) { console.warn("Automatic bank match left in queue:", error.message); }
        }
        if (!match) await db.prepare(`INSERT INTO bookkeeping_bank_feed_audit
          (id, book_id, bank_transaction_id, action, actor, details_json)
          VALUES (?, ?, ?, 'imported_to_matching_queue', ?, ?)`)
          .bind(crypto.randomUUID(), bookId, bankTransactionId, actor,
            JSON.stringify({ suggested_count: ranked.length, confidence: decision.confidence_score, reason: decision.reason })).run();
        imported.push({ bank_transaction_id: bankTransactionId, status: match ? "matched" : "needs_matching", match });
      }
      if (duplicates) await db.prepare(`UPDATE bookkeeping_bank_feed_imports SET duplicate_count = ? WHERE id = ?`).bind(duplicates, importId).run();
      return Response.json({ ok: true, import_id: importId, imported_count: imported.length, duplicate_count: duplicates, transactions: imported }, { status: 201 });
    }

    if (body.action === "approve_match") {
      const bookId = clean(body.book_id, 100);
      const bankTransactionId = clean(body.bank_transaction_id, 100);
      const targetId = clean(body.target_transaction_id, 100);
      const bankRow = await loadFeedRow(db, bookId, bankTransactionId);
      if (!bankRow) return responseError("Bank transaction not found", 404);
      if (["matched","skipped"].includes(bankRow.transaction_status)) return responseError("This bank transaction has already been reconciled or skipped", 409);
      const target = (await candidatesFor(db, bankRow)).find(row => row.id === targetId);
      if (!target) return responseError("Select an outstanding invoice or supplier bill from the current suggestions", 409);
      const result = await postMatch(db, bankRow, target, { method: "user_approved", confidence: target.score, actor });
      return Response.json({ ok: true, ...result });
    }

    if (body.action === "skip") {
      const bookId = clean(body.book_id, 100);
      const bankTransactionId = clean(body.bank_transaction_id, 100);
      const bankRow = await loadFeedRow(db, bookId, bankTransactionId);
      if (!bankRow) return responseError("Bank transaction not found", 404);
      if (bankRow.transaction_status !== "needs_matching") return responseError("Only an unmatched transaction can be skipped", 409);
      await db.batch([
        db.prepare(`UPDATE bookkeeping_bank_feed_transactions SET transaction_status = 'skipped' WHERE id = ? AND book_id = ?`).bind(bankTransactionId, bookId),
        db.prepare(`UPDATE bookkeeping_reconciliation_reviews SET review_status = 'skipped', decided_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE bank_transaction_id = ?`).bind(actor, bankTransactionId),
        db.prepare(`INSERT INTO bookkeeping_bank_feed_audit (id, book_id, bank_transaction_id, action, actor, details_json) VALUES (?, ?, ?, 'skipped', ?, ?)`)
          .bind(crypto.randomUUID(), bookId, bankTransactionId, actor, JSON.stringify({ reason: clean(body.reason, 500) }))
      ]);
      return Response.json({ ok: true, transaction_status: "skipped" });
    }
    return responseError("Unsupported bank reconciliation action");
  } catch (error) {
    console.error("Bank reconciliation POST error:", error);
    const status = /unique constraint/i.test(error.message || "") ? 409 : 500;
    return responseError(status === 409 ? "This bank transaction has already been recorded" : "Unable to process bank reconciliation", status);
  }
}
