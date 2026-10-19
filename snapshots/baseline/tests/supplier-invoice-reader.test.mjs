import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitiseSupplierInvoice } from "../functions/api/supplier-invoice-read.js";

const job = await readFile(new URL("../mini-fergus-job.html", import.meta.url), "utf8");
const materials = await readFile(new URL("../assets/jobhub-materials.js", import.meta.url), "utf8");
const materialApi = await readFile(new URL("../functions/api/job-materials.js", import.meta.url), "utf8");

test("supplier invoice reader preserves credit values and reconciles extracted lines", () => {
  const invoice = sanitiseSupplierInvoice({
    supplier: "J.A. Russell Ltd",
    document_type: "credit_note",
    invoice_number: "4963670",
    invoice_date: "2026-09-30",
    subtotal_ex_gst: -338.40,
    gst: -50.76,
    total_incl_gst: -389.16,
    confidence: 0.94,
    lines: [{
      stock_code: "ABC123",
      description: "Returned electrical item",
      quantity: 2,
      unit: "EA",
      unit_price_ex_gst: -169.20,
      extension_ex_gst: -338.40
    }]
  });

  assert.equal(invoice.document_type, "credit_note");
  assert.equal(invoice.subtotal_ex_gst, -338.40);
  assert.equal(invoice.lines[0].unit_price_ex_gst, -169.20);
  assert.equal(invoice.calculated_subtotal_ex_gst, -338.40);
  assert.deepEqual(invoice.warnings, []);
});

test("supplier invoice reader warns rather than silently trusting unreconciled lines", () => {
  const invoice = sanitiseSupplierInvoice({
    subtotal_ex_gst: 100,
    lines: [{ description: "Cable", quantity: 2, unit_price_ex_gst: 20, extension_ex_gst: 40 }]
  });
  assert.match(invoice.warnings.join(" "), /printed subtotal/i);
});

test("discounted lines use the net unit cost that reconciles to their extension", () => {
  const invoice = sanitiseSupplierInvoice({
    subtotal_ex_gst: 90,
    lines: [{ description: "Discounted cable", quantity: 2, unit_price_ex_gst: 50, extension_ex_gst: 90 }]
  });
  assert.equal(invoice.lines[0].unit_price_ex_gst, 45);
});

test("Job Hub presents an explicit review step and two import choices", () => {
  assert.match(job, /id="readMaterialsInvoice"/);
  assert.match(job, /id="materialsInvoicePreview"/);
  assert.match(job, /ADD TICKED LINES/);
  assert.match(job, /ADD TOTAL ONLY/);
  assert.match(materials, /\/api\/supplier-invoice-read/);
  assert.match(materials, /\/api\/job-materials-import/);
  assert.match(materials, /invoiceAlreadyImported/);
});

test("manual material costs allow negative credit-note values", () => {
  assert.match(job, /id="materialsUnitCost"[^>]*min="-10000000"/);
  assert.match(materialApi, /Math\.abs\(parsed\) <= max/);
});
