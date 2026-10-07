import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../config/initial-businesses.json", import.meta.url), "utf8"));
const accountingBridge = await readFile(new URL("../functions/api/customer-invoice-accounting.js", import.meta.url), "utf8");
const customerInvoices = await readFile(new URL("../functions/api/customer-invoices.js", import.meta.url), "utf8");

test("Solectrics and Sol Espresso are separate limited companies", () => {
  const solectrics = config.businesses.find(b => b.slug === "solectrics");
  const espresso = config.businesses.find(b => b.slug === "sol-espresso");
  assert.equal(solectrics.legal_name, "Solectrics Limited");
  assert.equal(solectrics.business_type, "company");
  assert.equal(espresso.legal_name, "Sol Espresso Limited");
  assert.equal(espresso.business_type, "company");
  assert.notEqual(solectrics.id, espresso.id);
  assert.notEqual(solectrics.book_strategy.book_code, espresso.book_strategy.book_code);
});

test("issued customer invoices post through the job's assigned bookkeeping book", () => {
  assert.match(accountingBridge, /bookkeeping_job_books/);
  assert.match(accountingBridge, /kind, transaction_date/);
  assert.match(accountingBridge, /'sales_invoice'/);
  assert.match(accountingBridge, /'customer_invoice'/);
  assert.match(accountingBridge, /Accounts receivable/);
  assert.match(accountingBridge, /Sales revenue/);
  assert.match(accountingBridge, /GST payable/);
});

test("customer invoice issue calls the accounting bridge without replacing operational invoicing", () => {
  assert.match(customerInvoices, /postIssuedCustomerInvoiceToBook/);
  assert.match(customerInvoices, /UPDATE customer_invoice_versions SET status/);
  assert.match(customerInvoices, /accounting_post_error/);
});
