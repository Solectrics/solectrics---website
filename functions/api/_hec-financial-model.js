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
    if(Number.isFinite(combinedInclGst)&&Number.isFinite(broadbandInclGst)&&Math.abs(electricityInclGst+broadbandInclGst-combinedInclGst)>.05)return null;
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

// Chronological AC-side half-hour simulation. Caller supplies measured or explicitly
// synthetic profiles; no household questionnaire answer is treated as interval data.
export function simulateIntervals({intervals, battery=null, evidence='synthetic', exportLimitKw=Infinity}) {
  if(!Array.isArray(intervals)||!intervals.length)throw Error('Interval profile required');
  if(!['synthetic','measured','modelled'].includes(evidence))throw Error('Profile provenance required');
  if(exportLimitKw!==Infinity)valid(exportLimitKw,'export limit');
  let capacity=0,reserve=0,chargeEfficiency=1,dischargeEfficiency=1,chargeKw=0,dischargeKw=0;
  if(battery){
    ({usableKwh:capacity,reserveKwh:reserve=0,chargeEfficiency,dischargeEfficiency,chargeKw,dischargeKw}=battery);
    if(typeof battery.capacitySource!=='string'||!battery.capacitySource.trim())throw Error('Usable capacity source required');
    for(const [k,v]of Object.entries({capacity,reserve,chargeKw,dischargeKw}))valid(v,k);
    if(!capacity||reserve>=capacity||!(chargeEfficiency>0&&chargeEfficiency<=1&&dischargeEfficiency>0&&dischargeEfficiency<=1))throw Error('Invalid battery specification');
  }
  let soc=0,previous=null;const days=new Set();
  const totals={baseline:0,netBill:0,loadKwh:0,pvKwh:0,directKwh:0,chargeKwh:0,dischargeKwh:0,lossKwh:0,exportKwh:0,gridKwh:0,curtailedKwh:0,fixed:0};
  for(const row of intervals){
    const stamp=Date.parse(row.start);
    if(!Number.isFinite(stamp)||!String(row.start).endsWith('Z')||(previous!==null&&stamp-previous!==1800000))throw Error('Consecutive UTC half-hour intervals required');
    previous=stamp;
    const {loadKwh,pvKwh,controlledKwh=0,importCents,controlledCents,dailyFixedCents,exportCents,gstBasis,fixedGstBasis,exportGstBasis}=row;
    for(const [k,v]of Object.entries({loadKwh,pvKwh,controlledKwh}))valid(v,k);
    if(controlledKwh>loadKwh)throw Error('Controlled load exceeds total');
    const rate=inclusiveRate(importCents,gstBasis),fixed=inclusiveRate(dailyFixedCents,fixedGstBasis),credit=inclusiveRate(exportCents,exportGstBasis);
    const controlledRate=controlledKwh?inclusiveRate(controlledCents,row.controlledGstBasis):0;
    // Controlled circuits remain grid-supplied unless a separate validated profile
    // explicitly moves that demand to a solar-connected circuit.
    const eligible=loadKwh-controlledKwh;
    const direct=Math.min(eligible,pvKwh);
    let surplus=pvKwh-direct,grid=eligible-direct;
    const charge=Math.min(surplus,chargeKw*.5,(capacity-reserve-soc)/chargeEfficiency);
    soc+=charge*chargeEfficiency;surplus-=charge;
    const discharge=Math.min(grid,dischargeKw*.5,soc*dischargeEfficiency);
    soc-=discharge/dischargeEfficiency;grid-=discharge;
    const exported=Math.min(surplus,exportLimitKw*.5),curtailed=surplus-exported;
    const day=new Date(stamp).toISOString().slice(0,10);const fixedToday=days.has(day)?0:fixed;days.add(day);
    totals.baseline+=fixedToday+eligible*rate+controlledKwh*controlledRate;
    totals.netBill+=fixedToday+grid*rate+controlledKwh*controlledRate-exported*credit;
    totals.fixed+=fixedToday;totals.loadKwh+=loadKwh;totals.pvKwh+=pvKwh;totals.directKwh+=direct;
    totals.chargeKwh+=charge;totals.dischargeKwh+=discharge;totals.lossKwh+=charge*(1-chargeEfficiency)+discharge/dischargeEfficiency-discharge;
    totals.exportKwh+=exported;totals.gridKwh+=grid+controlledKwh;totals.curtailedKwh+=curtailed;
  }
  return {...totals,savings:totals.baseline-totals.netBill,endingStoredKwh:soc,evidence,
    forecastApproved:false,limitations:['No grid charging, tariff optimisation, degradation or installed costs.','Controlled circuits stay on grid. Unused final stored energy has no credited value.']};
}

export function compareIntervalStorage(input){
 const solarOnly=simulateIntervals({...input,battery:null});
 const withBattery=simulateIntervals(input);
 return {solarOnly,withBattery,additionalBatterySavings:solarOnly.netBill-withBattery.netBill,forecastApproved:false};
}
