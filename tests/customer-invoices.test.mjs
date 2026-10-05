import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildInvoiceLines } from "../functions/api/customer-invoices.js";

test("customer invoice uses labour and marked-up actual materials without double counting estimates", () => {
  const lines = buildInvoiceLines({
    option: { default_markup_percent: 30 },
    actual_materials_cost: 216.01,
    lines: [
      { description: "Estimated materials", category: "materials", quantity: 1, customer_unit_price: 200, unit_code: "item", display_mode: "show" },
      { description: "Labour", category: "labour", quantity: 11, customer_unit_price: 75, unit_code: "hour", display_mode: "show" }
    ]
  });
  assert.equal(lines.length, 2);
  assert.equal(lines[0].description, "Labour");
  assert.equal(lines[0].total_ex_gst, 825);
  assert.equal(lines[1].description, "Materials");
  assert.equal(lines[1].total_ex_gst, 280.81);
  const subtotal = lines.reduce((sum, line) => sum + line.total_ex_gst, 0);
  const gst = Math.round(subtotal * 15) / 100;
  assert.equal(subtotal, 1105.81);
  assert.equal(gst, 165.87);
  assert.equal(Math.round((subtotal + gst) * 100) / 100, 1271.68);
});

test("only explicitly billable materials flow into the draft; actual job cost remains separate", () => {
  const lines = buildInvoiceLines({
    option: { default_markup_percent: 30 },
    actual_materials_cost: 150,
    billable_materials_cost: 100,
    billable_materials_charge: 130,
    lines: []
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].internal_cost_ex_gst, 100);
  assert.equal(lines[0].total_ex_gst, 130);
});

test("non-billable stock, warranty or other materials are not added to a customer invoice", () => {
  const lines = buildInvoiceLines({
    option: { default_markup_percent: 30 },
    actual_materials_cost: 50,
    billable_materials_cost: 0,
    billable_materials_charge: 0,
    lines: []
  });
  assert.deepEqual(lines, []);
});

test("estimated material costing remains available when actual materials have not been recorded", () => {
  const lines = buildInvoiceLines({
    option: { default_markup_percent: 30 }, actual_materials_cost: 0,
    lines: [{ description: "Materials allowance", category: "materials", quantity: 2, customer_unit_price: 40, unit_code: "item", display_mode: "show" }]
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].total_ex_gst, 80);
});

test("Job Hub exposes invoice creation and printable invoice pages", async () => {
  const jobPage = await readFile(new URL("../mini-fergus-job.html", import.meta.url), "utf8");
  const invoicePage = await readFile(new URL("../mini-fergus-customer-invoice.html", import.meta.url), "utf8");
  assert.match(jobPage, /GENERATE CUSTOMER INVOICE/);
  assert.match(jobPage, /value="137-174-537"/);
  assert.match(jobPage, /loadCustomerInvoices\(\)/);
  assert.match(invoicePage, /TAX INVOICE/);
  assert.match(invoicePage, /PRINT \/ SAVE PDF/);
});
