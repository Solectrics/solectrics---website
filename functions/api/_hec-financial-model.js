// Isolated, deterministic HEC financial calculation for review/testing.
// NOT connected to the public HEC report. Never publish a savings forecast
// without independently verifying input tariff tax bases, PV yield, hourly
// self-consumption and storage dispatch assumptions.
const GST_RATE = 0.15;

export function inclusiveRate(cents, gstBasis) {
  if (!Number.isFinite(cents) || cents < 0) throw new Error("Invalid rate");
  if (gstBasis !== "inclusive" && gstBasis !== "exclusive") {
    throw new Error("GST basis must be explicitly verified");
  }
  return cents / 100 * (gstBasis === "exclusive" ? 1 + GST_RATE : 1);
}

export function electricityInvoice({electricityInclGst, combinedInclGst, broadbandInclGst}) {
  if (Number.isFinite(electricityInclGst) && electricityInclGst >= 0) {
    return electricityInclGst;
  }
  if (Number.isFinite(combinedInclGst) && Number.isFinite(broadbandInclGst) &&
      combinedInclGst >= broadbandInclGst && broadbandInclGst >= 0) {
    return combinedInclGst - broadbandInclGst;
  }
  return null; // Never silently assume that broadband is electricity.
}

function valid(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid " + name);
}

export function compareMonth({
  importKwh, solarKwh, directSolarKwh, batteryDischargeKwh = 0,
  batteryChargeKwh = 0, days, importCents, importGstBasis,
  dailyFixedCents, fixedGstBasis, exportCents, exportGstBasis,
  batteryEfficiency = 0.90
}) {
  for (const [name,value] of Object.entries({
    importKwh,solarKwh,directSolarKwh,batteryDischargeKwh,batteryChargeKwh,days
  })) valid(value,name);
  if (!(days>0 && days<=31)) throw new Error("Invalid billing days");
  if (!(batteryEfficiency>0 && batteryEfficiency<=1)) throw new Error("Invalid battery efficiency");
  if (directSolarKwh > Math.min(importKwh,solarKwh)) {
    throw new Error("Direct self-use cannot exceed household demand or PV generation");
  }
  const solarSurplus=solarKwh-directSolarKwh;
  const gridAfterDirect=importKwh-directSolarKwh;
  if (batteryChargeKwh>solarSurplus ||
      batteryDischargeKwh>gridAfterDirect ||
      batteryDischargeKwh>batteryChargeKwh*batteryEfficiency+1e-8) {
    throw new Error("Battery energy balance impossible");
  }
  const importRate=inclusiveRate(importCents,importGstBasis);
  const fixedRate=inclusiveRate(dailyFixedCents,fixedGstBasis);
  // Export compensation is a credit, not a retail purchase; use only
  // a verified credit value without applying consumption GST by default.
  const exportRate=inclusiveRate(exportCents,exportGstBasis);
  const fixed=days*fixedRate;
  const baseline=fixed+importKwh*importRate;
  const exportKwh=solarSurplus-batteryChargeKwh;
  const withSolar=fixed+
    (gridAfterDirect-batteryDischargeKwh)*importRate-exportKwh*exportRate;
  const savings=baseline-withSolar;
  return {
    baseline,withSolar,savings,fixed,
    gridKwh:gridAfterDirect-batteryDischargeKwh,exportKwh,
    directSolarKwh,batteryDischargeKwh,
    // Negative net amounts are possible when credit exceeds purchases,
    // but must be shown as net credits, not "negative electricity usage".
    netCredit:withSolar<0
  };
}
