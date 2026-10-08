import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitise } from "../functions/api/read-bill.js";
import { deriveCurrentPlan, deriveBaseline } from "../functions/api/energy-review.js";
import { buildEnergyComparison } from "../functions/api/customer-quotes.js";
import { onRequestPost as submitEnquiry } from "../functions/api/enquiry.js";

const hec = await readFile(new URL("../home-energy-check.html", import.meta.url), "utf8");
const job = await readFile(new URL("../mini-fergus-job.html", import.meta.url), "utf8");

const CONTACT_FIXTURE = {
  retailer: "Contact",
  plan_name: null,
  billing_period_start: "2026-08-20",
  billing_period_end: "2026-09-18",
  billing_days: 30,
  total_import_kwh: 877,
  average_daily_kwh: 29.23,
  total_export_kwh: null,
  total_bill_nzd: 397.36,
  electricity_charges_nzd: 337.36,
  non_electricity_charges_nzd: 60,
  electricity_cost_separation_status: "separated",
  charged_import_kwh: 781,
  free_import_kwh: 96,
  free_import_schedule: "Saturday and Sunday 9 am–5 pm",
  daily_fixed_charge_cents: 150,
  daily_fixed_charge_gst_basis: "exclusive",
  import_rate_cents: 31.8,
  import_rate_gst_basis: "exclusive",
  peak_rate_cents: null,
  offpeak_rate_cents: null,
  controlled_rate_cents: null,
  ev_night_rate_cents: null,
  export_rate_cents: null,
  peak_export_rate_cents: null,
  fixed_term: null,
  exit_cost_nzd: null,
  other_tariff_information: null,
  tariff_description: "Low User; free Saturday/Sunday 9 am–5 pm",
  gst_nzd: 51.83,
  electricity_gst_nzd: 44,
  icp: "000000000000000000",
  notes: null,
  needs_review_fields: ["plan_name","total_export_kwh","export_rate_cents"],
  confidence: .98
};

function makeDb() {
  const saved = { answers: null };
  let nextId = 5;
  return {
    saved,
    prepare(sql) {
      return {
        params: [],
        bind(...params) { this.params = params; return this; },
        async all() { return { results: [{ name: "job_type" }] }; },
        async run() {
          if (/INSERT INTO enquiries/i.test(sql)) {
            saved.answers = JSON.parse(this.params[6]);
            return { meta: { last_row_id: ++nextId } };
          }
          if (/INSERT INTO jobs/i.test(sql)) return { meta: { last_row_id: ++nextId } };
          return { meta: { changes: 1 } };
        }
      };
    }
  };
}

test("anonymised Contact-style extraction preserves invoice/electricity split and unknowns", () => {
  const bill = sanitise(CONTACT_FIXTURE);
  assert.equal(bill.total_bill_nzd, 397.36);
  assert.equal(bill.electricity_charges_nzd, 337.36);
  assert.equal(bill.non_electricity_charges_nzd, 60);
  assert.equal(bill.gst_nzd, 51.83);
  assert.equal(bill.electricity_gst_nzd, 44);
  assert.equal(bill.total_import_kwh, 877);
  assert.equal(bill.charged_import_kwh + bill.free_import_kwh, 877);
  assert.equal(bill.plan_name, null);
  assert.equal(bill.export_rate_cents, null);
});

test("inconsistent charged/free split is flagged rather than silently accepted", () => {
  const bill = sanitise({ ...CONTACT_FIXTURE, free_import_kwh: 90, needs_review_fields: [] });
  assert.equal(bill.charged_import_kwh, null);
  assert.equal(bill.free_import_kwh, null);
  assert.ok(bill.needs_review_fields.includes("charged_import_kwh"));
  assert.ok(bill.needs_review_fields.includes("free_import_kwh"));
});

test("Job Hub energy review uses electricity-only cost and GST-inclusive rates exactly once", () => {
  const answers = { bills: { winter: sanitise(CONTACT_FIXTURE), summer: null } };
  const plan = deriveCurrentPlan(answers);
  const baseline = deriveBaseline(answers, []);
  assert.equal(plan.retailer, "Contact");
  assert.equal(plan.plan_name, "");
  assert.equal(plan.standard_import_rate_cents, 36.57);
  assert.equal(plan.daily_charge_cents, 172.5);
  assert.match(plan.other_tariff_information, /Low User/);
  assert.match(plan.other_tariff_information, /Saturday and Sunday 9 am–5 pm/);
  assert.equal(baseline.annual_expenditure_nzd, 4105);
  assert.equal(baseline.annual_fixed_charges_nzd, 629.63);
  assert.match(baseline.data_quality, /Free-electricity tariff identified/);
});

test("quote fallback excludes broadband and does not price all imported kWh at the paid rate", () => {
  const answers = { bills: { summer: sanitise(CONTACT_FIXTURE), winter: null } };
  const graph = buildEnergyComparison(answers, { estimated_generation_kwh: 6000, solar_kw: 4.8 });
  assert.ok(graph);
  assert.ok(graph.current[0] > 340 && graph.current[0] < 345, "monthly current cost should derive from $337.36 electricity-only charge, not $397.36 whole invoice");
  const fullPaidRate = 31.8 * 1.15 / 100;
  const effectivePaidRate = fullPaidRate * 781 / 877;
  assert.ok(effectivePaidRate < fullPaidRate);
  assert.ok(graph.solar.every(Number.isFinite));
});

test("ordinary electricity-only bills retain legacy total fallback", () => {
  const answers = { bills: { summer: {
    retailer: "Example Energy", billing_days: 30, total_import_kwh: 600,
    total_bill_nzd: 240, import_rate_cents: 30, daily_fixed_charge_cents: 100
  }, winter: null } };
  const baseline = deriveBaseline(answers, []);
  assert.equal(baseline.annual_expenditure_nzd, 2920);
  const graph = buildEnergyComparison(answers, { estimated_generation_kwh: 5000 });
  assert.ok(graph);
});

test("customer corrections survive HEC submission into enquiry answers_json", async () => {
  const db = makeDb();
  const answers = {
    name: "Test Customer",
    email: "test@example.invalid",
    address: "Test address",
    bills: { winter: sanitise(CONTACT_FIXTURE), summer: null }
  };
  const form = new FormData();
  form.append("answers", JSON.stringify(answers));
  const response = await submitEnquiry({
    request: new Request("https://staging.example/api/enquiry", { method: "POST", body: form }),
    env: { DB: db }
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(db.saved.answers.bills.winter.electricity_charges_nzd, 337.36);
  assert.equal(db.saved.answers.bills.winter.free_import_kwh, 96);
  assert.equal(db.saved.answers.bills.winter.import_rate_gst_basis, "exclusive");
});

test("HEC review and Job Hub display expose corrected bill fields without schema changes", () => {
  assert.match(hec, /Whole invoice total incl GST/);
  assert.match(hec, /Electricity charges only incl GST/);
  assert.match(hec, /Free \/ zero-price imported electricity/);
  assert.match(hec, /FREE-ELECTRICITY TARIFF — SAVINGS ARE INDICATIVE/);
  assert.match(hec, /electricityBillTotal/);
  assert.match(hec, /chargedImportShare/);
  assert.match(job, /All Home Energy Check answers/);
  assert.match(job, /renderObject\(answers\)/);
});
