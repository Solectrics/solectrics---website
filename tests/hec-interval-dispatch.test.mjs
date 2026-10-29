import test from 'node:test';import assert from 'node:assert/strict';
import {simulateIntervals,compareIntervalStorage,electricityInvoice}from '../functions/api/_hec-financial-model.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const rows=(loads,pv)=>loads.map((loadKwh,i)=>({start:new Date(Date.UTC(2026,0,1)+i*1800000).toISOString(),loadKwh,pvKwh:pv[i],importCents:30,gstBasis:'inclusive',dailyFixedCents:150,fixedGstBasis:'inclusive',exportCents:8,exportGstBasis:'inclusive'}));
const battery={usableKwh:8,capacitySource:'Synthetic specification only',reserveKwh:1,chargeEfficiency:.9,dischargeEfficiency:.9,chargeKw:4,dischargeKw:4};
test('chronology prevents evening demand being supplied by future solar',()=>{
 const v=simulateIntervals({intervals:rows([2,0],[0,4]),battery});near(v.gridKwh,2);near(v.dischargeKwh,0);near(v.endingStoredKwh,1.8);
});
test('storage conserves AC energy, accounts for charging losses and foregone export',()=>{
 const {solarOnly,withBattery:v,additionalBatterySavings}=compareIntervalStorage({intervals:rows([0,2],[4,0]),battery});
 near(v.chargeKwh,2);near(v.dischargeKwh,1.62);near(v.lossKwh,.38);near(v.gridKwh,.38);near(v.exportKwh,2);
 near(v.pvKwh,v.directKwh+v.chargeKwh+v.exportKwh+v.curtailedKwh);
 near(v.loadKwh,v.directKwh+v.dischargeKwh+v.gridKwh);
 near(additionalBatterySavings,1.62*.30-2*.08);near(v.fixed,1.5);near(solarOnly.fixed,v.fixed);
});
test('TOU prices apply at consumption time and controlled circuits are not silently shifted',()=>{
 const intervals=rows([0,3],[4,0]);intervals[1]={...intervals[1],importCents:50,controlledKwh:1,controlledCents:15,controlledGstBasis:'inclusive'};
 const r=simulateIntervals({intervals,battery});near(r.baseline,2*.5+1*.15+1.5);near(r.gridKwh,1.38);
 assert.throws(()=>simulateIntervals({intervals:[{...intervals[1],controlledCents:undefined}]}),/Invalid rate/);
});
test('flexible hot water, appliances or EV scheduling changes timing without inventing demand',()=>{
 const before=simulateIntervals({intervals:rows([0,2],[2,0])});const after=simulateIntervals({intervals:rows([2,0],[2,0])});
 near(before.loadKwh,after.loadKwh);near(after.directKwh,2);near(after.savings-before.savings,2*(.30-.08));
});
test('export limits curtail surplus; invalid profiles and missing usable capacity source fail',()=>{
 near(simulateIntervals({intervals:rows([0],[4]),exportLimitKw:2}).curtailedKwh,3);
 assert.throws(()=>simulateIntervals({intervals:rows([0],[4]),battery:{...battery,capacitySource:''}}),/source/);
 const profile=rows([0,1],[4,0]);profile[1].start=profile[0].start;assert.throws(()=>simulateIntervals({intervals:profile}),/Consecutive/);
 assert.equal(electricityInvoice({electricityInclGst:300,combinedInclGst:300,broadbandInclGst:90}),null);
});
test('full synthetic seasonal year has conserved energy and separately reports battery contribution',()=>{
 const intervals=Array.from({length:365*48},(_,i)=>{
  const hour=(i%48)/2,month=new Date(Date.UTC(2026,0,1)+i*1800000).getUTCMonth();
  const winter=month>=5&&month<=7;return {...rows([winter?.6:.3],[hour>=9&&hour<16?(winter?.7:1.2):0])[0],start:new Date(Date.UTC(2026,0,1)+i*1800000).toISOString()};
 });
 const r=compareIntervalStorage({intervals,battery});near(r.withBattery.fixed,365*1.5);near(r.additionalBatterySavings,r.withBattery.savings-r.solarOnly.savings);
 near(r.withBattery.chargeKwh,r.withBattery.dischargeKwh+r.withBattery.lossKwh+r.withBattery.endingStoredKwh);assert.equal(r.withBattery.forecastApproved,false);
});
