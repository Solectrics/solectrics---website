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


/*
  Solectrics HEC comparison sizes, not fixed products or quotes.
  Nominal 9 kWh must never be treated as verified usable energy.
  PV generation and load-shifting are supplied from a separately
  validated design/consumption model, not inferred from the label.
*/
export const SYSTEM_OPTIONS = Object.freeze({
  small: Object.freeze({pvKwMin:5,pvKwMax:5,batteryNominalKwh:0}),
  medium: Object.freeze({pvKwMin:6,pvKwMax:7,batteryNominalKwh:9}),
  large: Object.freeze({pvKwMin:8,pvKwMax:10,batteryNominalKwh:9})
});

export function compareSystemMonth({
  system, pvKw, usableBatteryKwh, withBattery=false,
  batteryChargeKwh=0, batteryDischargeKwh=0, ...month
}) {
  const option=SYSTEM_OPTIONS[system];
  if (!option) throw new Error("Unknown system option");
  if (!Number.isFinite(pvKw) || pvKw<option.pvKwMin || pvKw>option.pvKwMax) {
    throw new Error("PV system size outside chosen comparison range");
  }
  if (withBattery) {
    if (option.batteryNominalKwh===0) throw new Error("Small comparison has no battery");
    if (!Number.isFinite(usableBatteryKwh) || usableBatteryKwh<=0 ||
        usableBatteryKwh>option.batteryNominalKwh) {
      throw new Error("Verified usable battery capacity required");
    }
    // A monthly energy total cannot exceed a full cycle per day.
    // Daily/hourly modelling is still required for a customer forecast.
    if (batteryChargeKwh>usableBatteryKwh*month.days ||
        batteryDischargeKwh>usableBatteryKwh*month.days) {
      throw new Error("Battery throughput exceeds daily usable capacity");
    }
  } else if (batteryChargeKwh!==0 || batteryDischargeKwh!==0) {
    throw new Error("Solar-only comparison cannot dispatch a battery");
  }
  return compareMonth({
    ...month,
    batteryChargeKwh:withBattery?batteryChargeKwh:0,
    batteryDischargeKwh:withBattery?batteryDischargeKwh:0
  });
}


/*
  Reconcile *electricity-only, GST-inclusive* bill totals against a
  candidate flat tariff. The caller must supply the verified GST basis
  and the correct fixed daily charge. Agreement alone does not prove
  that the tariff is correct (discounts, demand charges, TOU and credits
  can offset each other). This is an audit tool, not approval to show
  customer savings.
*/
export function reconcileElectricityBill({
  importKwh,days,electricityInclGst,combinedInclGst,broadbandInclGst,
  importCents,importGstBasis,dailyFixedCents,fixedGstBasis
}) {
  valid(importKwh,"import kWh");
  valid(days,"billing days");
  if (!(days>0 && days<=366)) throw new Error("Invalid billing days");
  const actual=electricityInvoice({electricityInclGst,combinedInclGst,broadbandInclGst});
  if (actual===null) return {reconciled:false,reason:"Electricity-only amount unavailable"};
  const rate=inclusiveRate(importCents,importGstBasis);
  const fixed=inclusiveRate(dailyFixedCents,fixedGstBasis);
  const predicted=days*fixed+importKwh*rate;
  const difference=predicted-actual;
  return {
    actual,predicted,difference,
    absoluteDifference:Math.abs(difference),
    relativeDifference:actual>0?Math.abs(difference)/actual:null,
    reconciled:Math.abs(difference)<=Math.max(.02*actual,1),
    // This is the gross average variable price implied by the invoice
    // *if* the fixed charge and exclusions are correct; not a validated
    // retail tariff and not appropriate for TOU / controlled pricing.
    impliedImportCentsInclGst:importKwh>0?(actual-days*fixed)/importKwh*100:null
  };
}
