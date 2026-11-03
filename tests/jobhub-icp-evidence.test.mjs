import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildIcpEvidence, deriveCurrentPlan } from "../functions/api/energy-review.js";
import { compareTariffs } from "../functions/api/_energy-calculator.js";

const bill = (icp, end, retailer = "Genesis") => ({
  icp, retailer, billing_period_end: end,
  import_rate_cents: 28, daily_fixed_charge_cents: 130
});

test("matching seasonal bill ICPs retain normal bill-to-plan prefill", () => {
  const answers = { bills: {
    summer: bill("000-123", "2026-02-28"),
    winter: bill("000123", "2026-08-31")
  } };
  assert.equal(buildIcpEvidence(answers).bill_conflict, false);
  assert.equal(deriveCurrentPlan(answers).icp, "000123");
});

test("conflicting bill ICPs remain visible but must not auto-fill plan ICP", () => {
  const answers = { bills: {
    summer: bill("123456", "2026-02-28", "Old retailer"),
    winter: bill("999999", "2026-08-31", "New retailer")
  } };
  const evidence = buildIcpEvidence(answers);
  assert.equal(evidence.bill_conflict, true);
  assert.equal(evidence.conflicting, true);
  assert.deepEqual(evidence.sources.map(item => item.icp), ["123456", "999999"]);
  const plan = deriveCurrentPlan(answers);
  assert.equal(plan.icp, "");
  assert.equal(plan.retailer, "New retailer");
  assert.equal(plan.standard_import_rate_cents, 28);
});

test("flagged bill-reader ICP is not trusted as confirmed prefill", () => {
  const answers = { bills: {
    summer: { ...bill("1234", "2026-02-28"), needs_review_fields: ["icp"] },
    winter: bill("5678", "2026-08-31")
  } };
  const evidence = buildIcpEvidence(answers);
  assert.equal(evidence.sources[0].needs_review, true);
  assert.equal(evidence.conflicting, true);
  assert.equal(evidence.bill_conflict, false);
  assert.equal(deriveCurrentPlan(answers).icp, "5678");
});

test("site visit and design differences are read-only warnings, not automatic changes", () => {
  const answers = { bills: { winter: bill("1234", "2026-08-31") } };
  const evidence = buildIcpEvidence(answers,
    { visit_icp: "8888", visit_hw_physical_match: "investigate", visit_date: "2026-10-10" },
    { design_icp: "1234" });
  assert.equal(evidence.conflicting, true);
  assert.equal(evidence.bill_conflict, false);
  assert.equal(evidence.physical_match, "investigate");
  assert.equal(evidence.lookup_connected, false);
  assert.equal(deriveCurrentPlan(answers).icp, "1234");
});

test("missing records stay missing without assumed meter values", () => {
  const e = buildIcpEvidence({});
  assert.deepEqual(e.sources, []);
  assert.equal(e.conflicting, false);
  assert.equal(deriveCurrentPlan({}).icp, "");
});

test("UI does not falsely mark extracted current plan as checked today", () => {
  const html = fs.readFileSync(new URL("../mini-fergus-energy-review.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /last_verified_date:new Date\(/);
  assert.match(html, /icpEvidence/);
  assert.match(html, /Customer electricity bill \(needs manual verification\)/);
  assert.match(html, /HEC → summer\/winter bills/);
});

test("published effective date alone does not count as a checked tariff source", () => {
  const model = { grid_import_standard_kwh: 3000 };
  const tariff = {
    id: "current", retailer: "Example", plan_name: "Example",
    pricing_type: "flat", daily_charge_cents: 100,
    standard_import_rate_cents: 30,
    source_url: "https://example.test/tariff",
    effective_date: "2026-11-01"
  };
  assert.equal(compareTariffs(model, [tariff])[0].source_complete, false);
  assert.equal(compareTariffs(model, [{ ...tariff, last_verified_date: "2026-11-03" }])[0].source_complete, true);
});
