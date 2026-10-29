import test from "node:test";
import assert from "node:assert/strict";
import {inclusiveRate,electricityInvoice,compareMonth,compareSystemMonth,SYSTEM_OPTIONS} from "../functions/api/_hec-financial-model.js";

const near=(a,b)=>assert.ok(Math.abs(a-b)<0.001,`Expected ${a} approximately ${b}`);
test("GST basis must be explicit; exclusive rate converts to inclusive once",()=>{
  near(inclusiveRate(30,"exclusive"),0.345);
  near(inclusiveRate(30,"inclusive"),0.30);
  assert.throws(()=>inclusiveRate(30,undefined),/GST basis/);
});
test("electricity-only invoice excludes broadband and does not add GST twice",()=>{
  near(electricityInvoice({combinedInclGst:287.86,broadbandInclGst:90}),197.86);
  near(electricityInvoice({electricityInclGst:197.86,combinedInclGst:287.86,broadbandInclGst:90}),197.86);
  assert.equal(electricityInvoice({combinedInclGst:287.86}),null);
});
const base={
  importKwh:430,solarKwh:500,directSolarKwh:200,days:31,
  importCents:30,importGstBasis:"inclusive",
  dailyFixedCents:125,fixedGstBasis:"inclusive",
  exportCents:8,exportGstBasis:"inclusive"
};
test("solar saves imported energy value plus verified export credit; fixed charges remain",()=>{
  const v=compareMonth(base);
  near(v.baseline,167.75);
  near(v.withSolar,83.75);
  near(v.savings,84);
  near(v.fixed,38.75);
  near(v.exportKwh,300);
});
test("storage reduces grid purchases but sacrifices export credits and loses energy",()=>{
  const solar=compareMonth(base);
  const withBattery=compareMonth({...base,batteryChargeKwh:100,batteryDischargeKwh:90});
  near(withBattery.savings-solar.savings,90*.30-100*.08);
  assert.ok(withBattery.gridKwh<solar.gridKwh);
});
test("bad dispatch cannot invent energy",()=>{
  assert.throws(()=>compareMonth({...base,directSolarKwh:600}),/Direct self-use/);
  assert.throws(()=>compareMonth({...base,batteryChargeKwh:100,batteryDischargeKwh:100}),/Battery energy balance/);
  assert.throws(()=>compareMonth({...base,batteryChargeKwh:310}),/Battery energy balance/);
});
test("unknown export rate or GST basis blocks a result rather than assuming 12c",()=>{
  assert.throws(()=>compareMonth({...base,exportCents:undefined}),/Invalid rate/);
  assert.throws(()=>compareMonth({...base,importGstBasis:undefined}),/GST basis/);
});
test("net export credit is labelled separately from consumption",()=>{
  const v=compareMonth({...base,importKwh:100,directSolarKwh:60,solarKwh:1000});
  assert.ok(v.withSolar<0);
  assert.equal(v.netCredit,true);
  assert.ok(v.gridKwh>=0);
});

test("Solectrics indicative systems use 5 kW solar-only and 9 kWh nominal medium/large batteries",()=>{
  assert.deepEqual({...SYSTEM_OPTIONS.small},{pvKwMin:5,pvKwMax:5,batteryNominalKwh:0});
  assert.deepEqual({...SYSTEM_OPTIONS.medium},{pvKwMin:6,pvKwMax:7,batteryNominalKwh:9});
  assert.deepEqual({...SYSTEM_OPTIONS.large},{pvKwMin:8,pvKwMax:10,batteryNominalKwh:9});
});
test("small system is solar-only; medium and large can compare without a battery",()=>{
  const small=compareSystemMonth({...base,system:"small",pvKw:5});
  const medium=compareSystemMonth({...base,system:"medium",pvKw:6.5});
  const large=compareSystemMonth({...base,system:"large",pvKw:9});
  near(small.savings,medium.savings);
  near(medium.savings,large.savings);
  // Only explicit generation may change the result, never the size label alone.
  assert.throws(()=>compareSystemMonth({...base,system:"small",pvKw:5,withBattery:true,usableBatteryKwh:8}),/no battery/);
});
test("one 9 kWh nominal battery requires verified usable capacity and dispatch",()=>{
  const params={...base,system:"medium",pvKw:6.5,withBattery:true,batteryChargeKwh:100,batteryDischargeKwh:90};
  assert.throws(()=>compareSystemMonth(params),/usable battery capacity/);
  const battery=compareSystemMonth({...params,usableBatteryKwh:8});
  const solar=compareSystemMonth({...base,system:"medium",pvKw:6.5});
  near(battery.savings-solar.savings,19);
  assert.throws(()=>compareSystemMonth({...params,usableBatteryKwh:9.1}),/usable battery capacity/);
  assert.throws(()=>compareSystemMonth({...params,usableBatteryKwh:2}),/throughput/);
});
test("system range and solar-only dispatch are validated",()=>{
  assert.throws(()=>compareSystemMonth({...base,system:"medium",pvKw:5}),/size outside/);
  assert.throws(()=>compareSystemMonth({...base,system:"large",pvKw:11}),/size outside/);
  assert.throws(()=>compareSystemMonth({...base,system:"large",pvKw:9,batteryChargeKwh:12}),/Solar-only comparison/);
});
