import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../home-energy-check.html", import.meta.url), "utf8");
const reader = await readFile(new URL("../functions/api/read-bill.js", import.meta.url), "utf8");
function sourceFunction(name, nextMarker) {
  const start = html.indexOf("function " + name + "(");
  const end = html.indexOf(nextMarker, start);
  assert.ok(start >= 0 && end > start, "Missing " + name + " function");
  return html.slice(start, end);
}
const code = [
  'function num(value){const n=Number(value);return Number.isFinite(n)?n:null;}',
  sourceFunction("billNumber", "function average("),
  sourceFunction("billingDays", "function monthlyImport("),
  sourceFunction("monthlyBillCost", "function importRateFromBill("),
  sourceFunction("importRateFromBill", "function exportRateFromBill("),
].join("\n");
const ctx = vm.createContext({});
vm.runInContext(code, ctx);

test("Contact combined bill excludes broadband and does not add GST twice", () => {
  const bill = {
    total_bill_nzd: 645.16,
    electricity_total_incl_gst_nzd: 555.16,
    broadband_total_incl_gst_nzd: 90,
    billing_days: 31,
    total_import_kwh: 1718,
    daily_fixed_charge_cents: 249.9,
    gst_nzd: 84.15
  };
  const monthly = vm.runInContext("monthlyBillCost", ctx)(bill);
  assert.ok(Math.abs(monthly - 555.16 / 31 * 30.4375) < 0.001);
  const rate = vm.runInContext("importRateFromBill", ctx)(bill);
  assert.ok(rate < 0.4, "Broadband must not inflate inferred unit rate");
});

test("combined bill with explicit broadband can infer electricity-only cost", () => {
  const bill = { total_bill_nzd: 645.16, broadband_total_incl_gst_nzd: 90, billing_days: 31 };
  assert.ok(Math.abs(vm.runInContext("monthlyBillCost", ctx)(bill) - 555.16 / 31 * 30.4375) < 0.001);
});

test("unseparated bill is not treated as electricity-only cost", () => {
  const bill = { total_bill_nzd: 645.16, billing_days: 31, total_import_kwh: 1718 };
  assert.equal(vm.runInContext("monthlyBillCost", ctx)(bill), null);
  assert.equal(vm.runInContext("importRateFromBill", ctx)(bill), null);
});

test("bill parser has electricity-only and broadband fields with GST-inclusive meaning", () => {
  assert.match(reader, /electricity_total_incl_gst_nzd/);
  assert.match(reader, /broadband_total_incl_gst_nzd/);
  assert.match(reader, /do not add GST again/i);
});
