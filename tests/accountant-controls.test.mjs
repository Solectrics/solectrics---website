import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../migrations/0020_accountant_controls.sql", import.meta.url), "utf8");
const controls = await readFile(new URL("../functions/api/bookkeeping-controls.js", import.meta.url), "utf8");
const api = await readFile(new URL("../functions/api/accountant-controls.js", import.meta.url), "utf8");
const bookkeeping = await readFile(new URL("../functions/api/bookkeeping.js", import.meta.url), "utf8");
const invoice = await readFile(new URL("../functions/api/customer-invoice-accounting.js", import.meta.url), "utf8");
const supplier = await readFile(new URL("../functions/api/supplier-invoice-inbox.js", import.meta.url), "utf8");
const bank = await readFile(new URL("../functions/api/bank-reconciliation.js", import.meta.url), "utf8");

test("accountant controls schema is additive and book-scoped", () => {
  assert.match(migration, /bookkeeping_period_locks/);
  assert.match(migration, /bookkeeping_credit_notes/);
  assert.match(migration, /bookkeeping_accountant_adjustments/);
  assert.match(migration, /book_id TEXT NOT NULL/);
});

test("GST report is book and period scoped", () => {
  assert.match(api, /tax_type='gst'/);
  assert.match(api, /event_date>=\? AND event_date<=\?/);
  assert.match(api, /net_gst_payable/);
});

test("period locks protect all main posting routes", () => {
  assert.match(controls, /ACCOUNTING_PERIOD_LOCKED/);
  assert.match(bookkeeping, /assertAccountingDateOpen\(db, bookId, date\)/);
  assert.match(invoice, /assertAccountingDateOpen\(db, assignment\.book_id, issueDate\)/);
  assert.match(supplier, /assertAccountingDateOpen\(db, bookId, invoiceDate\)/);
  assert.match(bank, /assertAccountingDateOpen\(db, bankRow\.book_id, bankRow\.transaction_date\)/);
});

test("customer credit notes reverse revenue, GST and accounts receivable", () => {
  assert.match(api, /customer_credit_note/);
  assert.match(api, /original_transaction_id/);
  assert.match(api, /"1100","2200","4000"/);
  assert.match(api, /Output GST reversed by customer credit note/);
});

test("accountant adjustments require balanced journals and review state", () => {
  assert.match(api, /validateJournalLines\(lines\)/);
  assert.match(api, /accountant_adjustment/);
  assert.match(api, /review_adjustment/);
  assert.match(api, /review_status/);
});
