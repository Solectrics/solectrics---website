const NUMBER_FIELDS = [
  "grid_import_standard_kwh",
  "grid_import_peak_kwh",
  "grid_import_offpeak_kwh",
  "grid_import_controlled_kwh",
  "grid_import_ev_kwh",
  "solar_export_standard_kwh",
  "solar_export_peak_kwh"
];

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegative(value) {
  const parsed = number(value);
  return parsed === null ? 0 : Math.max(0, parsed);
}

function rateFor(tariff, preferred, fallback = "standard_import_rate_cents") {
  const preferredRate = number(tariff?.[preferred]);
  if (preferredRate !== null) return preferredRate;
  if (preferred !== fallback && tariff?.pricing_type === "flat") return number(tariff?.[fallback]);
  return null;
}

export function normaliseEnergyModel(model = {}) {
  const normalised = {};
  for (const field of NUMBER_FIELDS) normalised[field] = nonNegative(model[field]);
  normalised.annual_consumption_kwh = nonNegative(model.annual_consumption_kwh);
  normalised.solar_generation_kwh = nonNegative(model.solar_generation_kwh);
  normalised.direct_solar_self_consumption_kwh = nonNegative(model.direct_solar_self_consumption_kwh);
  normalised.battery_charge_kwh = nonNegative(model.battery_charge_kwh);
  normalised.battery_to_load_kwh = nonNegative(model.battery_to_load_kwh);
  normalised.flex_shifted_to_solar_kwh = nonNegative(model.flex_shifted_to_solar_kwh);
  normalised.flex_shifted_to_offpeak_kwh = nonNegative(model.flex_shifted_to_offpeak_kwh);
  return normalised;
}

export function calculateTariffCost(modelInput = {}, tariff = {}) {
  const model = normaliseEnergyModel(modelInput);
  const missing = [];
  const components = [];
  const addImport = (usageField, label, preferredRate) => {
    const kwh = model[usageField];
    if (!kwh) return;
    const rate = rateFor(tariff, preferredRate);
    if (rate === null) {
      missing.push(`${label} import rate`);
      return;
    }
    components.push({ type: "import", label, kwh, rate_cents: rate, amount_nzd: kwh * rate / 100 });
  };
  const addExport = (usageField, label, preferredRate) => {
    const kwh = model[usageField];
    if (!kwh) return;
    const rate = number(tariff?.[preferredRate]);
    if (rate === null) {
      missing.push(`${label} export rate`);
      return;
    }
    components.push({ type: "export", label, kwh, rate_cents: rate, amount_nzd: -(kwh * rate / 100) });
  };

  addImport("grid_import_standard_kwh", "Standard", "standard_import_rate_cents");
  addImport("grid_import_peak_kwh", "Peak", "peak_import_rate_cents");
  addImport("grid_import_offpeak_kwh", "Off-peak", "offpeak_import_rate_cents");
  addImport("grid_import_controlled_kwh", "Controlled", "controlled_import_rate_cents");
  addImport("grid_import_ev_kwh", "EV / night", "ev_night_rate_cents");
  addExport("solar_export_standard_kwh", "Standard", "solar_export_rate_cents");
  addExport("solar_export_peak_kwh", "Peak", "peak_solar_export_rate_cents");

  const dailyCharge = number(tariff.daily_charge_cents);
  if (dailyCharge === null) missing.push("daily charge");
  else components.push({ type: "fixed", label: "Daily charge", amount_nzd: dailyCharge * 365 / 100 });

  const annualFees = nonNegative(tariff.annual_fees_nzd);
  if (annualFees) components.push({ type: "fee", label: "Annual fees", amount_nzd: annualFees });

  const recurring = missing.length
    ? null
    : components.reduce((sum, component) => sum + component.amount_nzd, 0);
  const transition = nonNegative(tariff.transition_cost_nzd) + nonNegative(tariff.exit_cost_nzd);

  return {
    complete: missing.length === 0,
    missing,
    components,
    recurring_annual_cost_nzd: recurring === null ? null : Math.max(0, recurring),
    transition_cost_nzd: transition,
    first_year_cost_nzd: recurring === null ? null : Math.max(0, recurring + transition)
  };
}

export function compareTariffs(model, tariffs = []) {
  return tariffs.map(tariff => ({
    tariff_id: tariff.id,
    retailer: tariff.retailer,
    plan_name: tariff.plan_name,
    source_complete: Boolean(tariff.source_url && (tariff.last_verified_date || tariff.effective_date)),
    ...calculateTariffCost(model, tariff)
  })).sort((a, b) => {
    if (a.recurring_annual_cost_nzd === null) return 1;
    if (b.recurring_annual_cost_nzd === null) return -1;
    return a.recurring_annual_cost_nzd - b.recurring_annual_cost_nzd;
  });
}
