import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCustomerOptions,
  buildEnergyComparison
} from "../functions/api/customer-quotes.js";

test("solar quote options are ordered battery-later before battery-now", () => {
  const options = buildCustomerOptions([
    { id: "battery", name: "Solar + Battery Now" },
    { id: "solar", name: "Solar Now, Battery Later" }
  ], [
    { id: "1", option_id: "solar", description: "Solar array", quantity: 1, customer_unit_price: 100, display_mode: "show" },
    { id: "2", option_id: "battery", description: "Solar and battery", quantity: 1, customer_unit_price: 200, display_mode: "show" }
  ]);

  assert.deepEqual(options.map(option => option.name), [
    "Solar Now, Battery Later",
    "Solar + Battery Now"
  ]);
  assert.equal(options[1].total_incl_gst, 230);
});

test("saved Home Energy Check graph is preserved exactly", () => {
  const twelve = Array.from({ length: 12 }, (_, index) => index + 1);
  const graph = buildEnergyComparison({
    quote_graph: {
      current: twelve,
      solar: twelve.map(value => value / 2),
      battery: twelve.map(value => value / 4),
      estimateSource: "two-bills"
    }
  });

  assert.equal(graph.source, "two-bills");
  assert.deepEqual(graph.current, twelve);
  assert.equal(graph.battery.length, 12);
});

test("existing jobs receive a twelve-month bill-based graph fallback", () => {
  const graph = buildEnergyComparison({
    bills: {
      summer: { total_import_kwh: 600, billing_days: 60, total_bill_nzd: 240 },
      winter: { total_import_kwh: 1000, billing_days: 60, total_bill_nzd: 400 }
    }
  }, {
    estimated_generation_kwh: 11000,
    import_rate: .34,
    export_rate: .12
  });

  assert.equal(graph.source, "two-bills");
  assert.equal(graph.current.length, 12);
  assert.equal(graph.solar.length, 12);
  assert.equal(graph.battery.length, 12);
  assert.ok(graph.battery[6] < graph.solar[6]);
});

test("graph is omitted when there is not enough customer data", () => {
  assert.equal(buildEnergyComparison({}, { estimated_generation_kwh: 9000 }), null);
});
