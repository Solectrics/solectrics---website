import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { calculateTariffCost, compareTariffs } from "../functions/api/_energy-calculator.js";
import {
  applyCurrentSystemDesign,
  modelReadinessIssues,
  tariffHasVerifiedSource
} from "../functions/api/energy-review.js";

const model = {
  model_ready: true,
  grid_import_standard_kwh: 1800,
  grid_import_offpeak_kwh: 1200,
  solar_export_standard_kwh: 2500
};

test("whole annual cost includes fixed, import, export and transition costs", () => {
  const result = calculateTariffCost(model, {
    pricing_type: "flat",
    daily_charge_cents: 120,
    standard_import_rate_cents: 32,
    offpeak_import_rate_cents: 18,
    solar_export_rate_cents: 14,
    annual_fees_nzd: 40,
    transition_cost_nzd: 75
  });
  assert.equal(result.complete, true);
  assert.equal(result.recurring_annual_cost_nzd, 920);
  assert.equal(result.first_year_cost_nzd, 995);
});

test("comparison does not invent a missing rate", () => {
  const result = calculateTariffCost(model, {
    daily_charge_cents: 120,
    standard_import_rate_cents: 32,
    solar_export_rate_cents: 14
  });
  assert.equal(result.complete, false, "an unknown pricing structure must not silently reuse a rate");
  assert.deepEqual(result.missing, ["Off-peak import rate"]);

  const missingExport = calculateTariffCost(model, {
    pricing_type: "flat",
    daily_charge_cents: 120,
    standard_import_rate_cents: 32
  });
  assert.equal(missingExport.complete, false);
  assert.deepEqual(missingExport.missing, ["Standard export rate"]);
  assert.equal(missingExport.recurring_annual_cost_nzd, null);
});

test("plans rank by whole recurring annual cost, not export rate alone", () => {
  const compared = compareTariffs(model, [
    { id: "high-export", retailer: "A", plan_name: "High export", pricing_type: "time_of_use", daily_charge_cents: 200, standard_import_rate_cents: 40, offpeak_import_rate_cents: 28, solar_export_rate_cents: 20, source_url: "https://example.com/a", last_verified_date: "2026-09-27" },
    { id: "balanced", retailer: "B", plan_name: "Balanced", pricing_type: "time_of_use", daily_charge_cents: 80, standard_import_rate_cents: 29, offpeak_import_rate_cents: 16, solar_export_rate_cents: 12, source_url: "https://example.com/b", last_verified_date: "2026-09-27" }
  ]);
  assert.equal(compared[0].tariff_id, "balanced");
});

test("review page and migration expose the requested modular architecture", () => {
  const html = fs.readFileSync(new URL("../mini-fergus-energy-review.html", import.meta.url), "utf8");
  const migration = fs.readFileSync(new URL("../migrations/0013_energy_tariff_reviews.sql", import.meta.url), "utf8");
  assert.match(html, /Your Electricity Plan After Solar/);
  assert.match(html, /No automatic switching/);
  assert.match(html, /Import EIEP14A tariff file/);
  assert.match(migration, /source_format/);
  assert.match(migration, /source_record_id/);
  assert.match(migration, /post_install_actuals_json/);
});


test("a design review gate prevents old assessment sizing from carrying forward", () => {
  const saved = { solar_array_kw: 14.25, estimated_annual_solar_generation_kwh: 22000, battery_capacity_kwh: 20 };
  const unreviewed = applyCurrentSystemDesign(saved, { design_reviewed: false }, { solar_kw: 14.25 });
  assert.equal(unreviewed.system_design_confirmed, false);
  assert.equal(unreviewed.solar_array_kw, null);
  assert.equal(unreviewed.estimated_annual_solar_generation_kwh, null);
  assert.equal(unreviewed.battery_capacity_kwh, null);

  const reviewed = applyCurrentSystemDesign(saved, {
    design_reviewed: true, design_array_kw: "6.2", design_battery_kwh: "10.7", design_inverter_model: "Current inverter"
  }, { estimated_generation_kwh: 8500 });
  assert.equal(reviewed.solar_array_kw, 6.2);
  assert.equal(reviewed.estimated_annual_solar_generation_kwh, 8500);
  assert.equal(reviewed.battery_capacity_kwh, 10.7);
});

test("model readiness requires every cost-driving flow and a reviewed system design", () => {
  const review = {
    selected_scenario: "solar_only",
    proposed_system: { system_design_confirmed: true, solar_array_kw: 6 },
    model: {
      annual_consumption_kwh: 7000,
      solar_generation_kwh: 8500,
      grid_import_standard_kwh: 1000,
      grid_import_peak_kwh: 0,
      grid_import_offpeak_kwh: 0,
      grid_import_controlled_kwh: 1200,
      grid_import_ev_kwh: 0,
      solar_export_standard_kwh: 3000,
      solar_export_peak_kwh: 0
    }
  };
  assert.deepEqual(modelReadinessIssues(review), []);
  delete review.model.grid_import_offpeak_kwh;
  assert.match(modelReadinessIssues(review).join(" "), /Off-peak grid imports/);
  review.proposed_system.system_design_confirmed = false;
  assert.match(modelReadinessIssues(review).join(" "), /System Design as reviewed/);
});

test("a tariff source requires a source name or URL and a last-verified date", () => {
  assert.equal(tariffHasVerifiedSource({ source_name: "Retailer plan page", effective_date: "2026-09-01" }), false);
  assert.equal(tariffHasVerifiedSource({ source_url: "https://retailer.example/solar", last_verified_date: "2026-09-27" }), true);
  assert.equal(tariffHasVerifiedSource({ source_name: "Customer electricity bill", last_verified_date: "2026-09-27" }), true);
});
