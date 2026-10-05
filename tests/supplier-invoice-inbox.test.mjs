import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitiseSupplierInvoice } from "../functions/api/supplier-invoice-read.js";
import { normalizeInvoiceIdentity, rankSupplierJobSuggestions, supplierInvoiceAmountsReconcile, supplierInvoiceDuplicate } from "../functions/api/supplier-invoice-matching.js";

const realInvoices = JSON.parse(await readFile(new URL("./fixtures/real-ja-russell-invoice-extractions.json", import.meta.url), "utf8"));
const inboxPage = await readFile(new URL("../mini-fergus-supplier-invoices.html", import.meta.url), "utf8");
const inboxApi = await readFile(new URL("../functions/api/supplier-invoice-inbox.js", import.meta.url), "utf8");
const reader = await readFile(new URL("../functions/api/supplier-invoice-read.js", import.meta.url), "utf8");
const materialApi = await readFile(new URL("../functions/api/job-materials.js", import.meta.url), "utf8");

test("real J.A. Russell invoice values survive extraction sanitising and reconcile", () => {
  for (const source of realInvoices) {
    const invoice = sanitiseSupplierInvoice(source);
    assert.equal(invoice.supplier, "J.A. Russell Ltd");
    assert.equal(invoice.invoice_number, source.invoice_number);
    assert.equal(invoice.invoice_date, source.invoice_date);
    assert.equal(invoice.subtotal_ex_gst, source.subtotal_ex_gst);
    assert.equal(invoice.gst, source.gst);
    assert.equal(invoice.total_incl_gst, source.total_incl_gst);
    assert.ok(Math.abs(invoice.subtotal_ex_gst + invoice.gst - invoice.total_incl_gst) <= 0.02);
    assert.equal(invoice.warnings.length, 0);
  }
});

test("uploaded one-page J.A. Russell invoice 43423918 matches printed totals and suggests GREG without auto-assigning", () => {
  const source = realInvoices.find(invoice => invoice.invoice_number === "43423918");
  assert.ok(source);
  const invoice = sanitiseSupplierInvoice(source);
  assert.deepEqual([invoice.invoice_date, invoice.subtotal_ex_gst, invoice.gst, invoice.total_incl_gst], ["2026-09-23", 89.98, 13.5, 103.48]);
  assert.equal(invoice.calculated_subtotal_ex_gst, 89.98);
  assert.equal(supplierInvoiceAmountsReconcile(invoice.subtotal_ex_gst, invoice.gst, invoice.total_incl_gst, invoice.gst), true);
  assert.deepEqual(rankSupplierJobSuggestions([{job_id: 4342, enquiry_ref: "JOB-4342", customer_name: "Greg Wilson", job_status: "in_progress"}], invoice.purchase_order_reference).map(job => job.job_id), [4342]);
  assert.match(inboxPage, /Choose a job/);
});

test("real duplicate J.A. Russell invoice number is caught per book but not across books", () => {
  const original = { book_id: "solectrics", supplier_name: "J.A. Russell Ltd", supplier_invoice_number: "43357185", content_sha256: "same-pdf-hash" };
  assert.equal(supplierInvoiceDuplicate(original, { book_id: "solectrics", supplier_name: "JA Russell Limited", supplier_invoice_number: "43357185" }), true);
  assert.equal(supplierInvoiceDuplicate(original, { book_id: "sol-espresso", supplier_name: "J.A. Russell Ltd", supplier_invoice_number: "43357185" }), false);
  assert.equal(normalizeInvoiceIdentity("J.A. Russell Ltd"), "JARUSSELLLTD");
});

test("multi-invoice J.A. Russell PDF bundles are rejected for combined totals", () => {
  const invoiceNumbers = ["43384152", "43384149", "43374400", "43374410", "43374385", "43367264", "43348591", "43357185"];
  const invoice = sanitiseSupplierInvoice({
    supplier: "J.A. Russell Ltd",
    multiple_documents: true,
    invoice_numbers: invoiceNumbers,
    subtotal_ex_gst: 800,
    gst: 120,
    total_incl_gst: 920,
    confidence: 0.99,
    lines: [{ description: "Combined lines from several invoices", quantity: 1, unit_price_ex_gst: 800, extension_ex_gst: 800 }]
  });
  assert.equal(invoice.multiple_documents, true);
  assert.equal(invoice.invoice_number, null);
  assert.equal(invoice.subtotal_ex_gst, null);
  assert.equal(invoice.gst, null);
  assert.equal(invoice.total_incl_gst, null);
  assert.equal(invoice.lines.length, 0);
  assert.ok(invoice.warnings.some(warning => /more than one supplier invoice/i.test(warning)));
});

test("supplier totals and allowable input GST require arithmetic validation", () => {
  assert.equal(supplierInvoiceAmountsReconcile(204.24, 30.64, 234.88, 30.64), true);
  assert.equal(supplierInvoiceAmountsReconcile(204.24, 30.64, 234.89, 30.64), false);
  assert.equal(supplierInvoiceAmountsReconcile(204.24, 30.64, 234.88, 30.65), false);
});

test("ambiguous J.A. Russell customer-name references remain suggestions for user review", () => {
  const suggestions = rankSupplierJobSuggestions([
    { job_id: 40, enquiry_ref: "REF-40", customer_name: "Damien Smith", job_status: "accepted" },
    { job_id: 41, enquiry_ref: "REF-41", customer_name: "Damien Jones", job_status: "in_progress" }
  ], "DAMIEN");
  assert.equal(suggestions.length, 2);
  assert.equal(suggestions[0].score, 65);
  assert.match(inboxPage, /Choose a job/);
  assert.match(inboxApi, /Number\(body\.job_id\)/);
  assert.match(reader, /reason === "Exact supplier reference"/);
});

test("a unique supplier reference is an exact high-confidence job match", () => {
  const suggestions = rankSupplierJobSuggestions([
    { job_id: 44, supplier_reference: "S0044", customer_name: "Greg Wilson", job_status: "active" },
    { job_id: 45, supplier_reference: "S0045", customer_name: "Alex Smith", job_status: "active" }
  ], "S0044");
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].job_id, 44);
  assert.equal(suggestions[0].score, 100);
  assert.equal(suggestions[0].reason, "Exact supplier reference");
});

test("supplier inbox review distinguishes billable from non-billable materials", () => {
  assert.match(inboxPage, /Customer billing treatment/);
  assert.match(inboxPage, /Do not charge customer/);
  assert.match(inboxApi, /billable_to_customer/);
  assert.match(inboxApi, /customer_markup_percent/);
  assert.match(inboxApi, /documentType === "credit_note"/);
  assert.match(inboxApi, /documentType === "credit_note" \? "adjustment" : "supplier_bill"/);
  assert.match(materialApi, /source === "stock" \? 0 : 1/);
});

test("inbox keeps the existing Hnry route untouched and stores PDFs before job assignment", () => {
  assert.match(inboxApi, /supplier-inbox\/\$\{book\.id\}/);
  assert.match(inboxApi, /content_sha256/);
  assert.match(inboxApi, /SUPPLIER_INBOX_SECRET/);
  assert.match(inboxApi, /source_type/);
  assert.match(reader, /multiple_documents/);
  assert.match(inboxPage, /Existing J\.A\. Russell → Zapier → Hnry delivery is unchanged/);
});
