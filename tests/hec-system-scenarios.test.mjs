import test from "node:test";
import assert from "node:assert/strict";
import {compareSystemMonth} from "../functions/api/_hec-financial-model.js";

/*
  FICTIONAL scenario only; NOT EECA benchmark or customer forecast.
  Seasonal load: fictional bills, 430 kWh in 31 summer days and
  1040 kWh in 30 winter days, scaled to average month length.
  PV: illustrative Auckland production 1250 kWh/kWp/year, monthly
  shares from the current HEC. Not independently site-validated.
  Prices: hypothetical, GST-inclusive 35c import, 150c/day fixed,
  and 8c export credit. These are NOT extracted/verified tariffs.
  Battery: hypothetical 8 kWh usable from 9 kWh nominal, 90%
  roundtrip and max 55% cycle/day; dispatch heuristic only.
*/
const weights=[0,.05,.18,.40,.68,.90,1,.88,.62,.36,.15,.03];
const solarShare=[.115,.105,.095,.072,.055,.043,.047,.060,.080,.100,.108,.120];
const days=[31,28,31,30,31,30,31,31,30,31,30,31];
const summer=430/31*30.4375, winter=1040/30*30.4375;
const assumptions={importCents:35,importGstBasis:"inclusive",
 dailyFixedCents:150,fixedGstBasis:"inclusive",
 exportCents:8,exportGstBasis:"inclusive"};
function modelYear(system,pvKw,{withBattery=false,exportCents=8,directShare=.38}={}){
 let baseline=0,withSolar=0,savings=0,exportKwh=0,directKwh=0,batteryKwh=0;
 for(let m=0;m<12;m++){
   const use=(summer+(winter-summer)*weights[m])*days[m]/30.4375;
   const pv=pvKw*1250*solarShare[m];
   // This direct-consumption heuristic is explicitly not an hourly model.
   const direct=Math.min(use*.50,pv*directShare);
   const surplus=pv-direct;
   const nightDemand=use-direct;
   const charge=withBattery?Math.min(surplus*.30,8*days[m]*.55,nightDemand/.9):0;
   const discharge=charge*.90;
   const v=compareSystemMonth({
     ...assumptions,exportCents,days:days[m],importKwh:use,
     solarKwh:pv,directSolarKwh:direct,system,pvKw,
     withBattery,usableBatteryKwh:withBattery?8:undefined,
     batteryChargeKwh:charge,batteryDischargeKwh:discharge
   });
   baseline+=v.baseline;withSolar+=v.withSolar;savings+=v.savings;
   exportKwh+=v.exportKwh;directKwh+=v.directSolarKwh;
   batteryKwh+=v.batteryDischargeKwh;
 }
 return {baseline,withSolar,savings,exportKwh,directKwh,batteryKwh};
}
test("fictional demand: small 5 kW, medium 6.5 kW, large 9 kW scenarios reconcile",()=>{
 for(const [system,kw] of [["small",5],["medium",6.5],["large",9]]){
   const solar=modelYear(system,kw);
   assert.ok(solar.baseline>2500&&solar.baseline<5000);
   assert.ok(solar.savings>0);
   assert.ok(Math.abs(solar.baseline-solar.withSolar-solar.savings)<.001);
   assert.ok(solar.directKwh>0 && solar.exportKwh>0);
   if(system!=="small"){
     const battery=modelYear(system,kw,{withBattery:true});
     assert.ok(battery.batteryKwh>0);
     assert.ok(battery.withSolar<solar.withSolar);
     assert.ok(battery.exportKwh<solar.exportKwh);
     assert.ok(battery.savings>solar.savings);
   }
 }
});
test("raising export tariff increases solar-only credits but reduces incremental battery benefit",()=>{
 const lowSolar=modelYear("medium",6.5,{exportCents:5});
 const highSolar=modelYear("medium",6.5,{exportCents:12});
 const lowBattery=modelYear("medium",6.5,{withBattery:true,exportCents:5});
 const highBattery=modelYear("medium",6.5,{withBattery:true,exportCents:12});
 assert.ok(highSolar.savings>lowSolar.savings);
 assert.ok(lowBattery.savings-lowSolar.savings>highBattery.savings-highSolar.savings);
});
test("larger PV arrays do not guarantee the same financial return per extra kW",()=>{
 const options=[modelYear("small",5),modelYear("medium",6.5),modelYear("large",9)];
 assert.ok(options[2].exportKwh>options[0].exportKwh);
 const incrementalSmallToMedium=(options[1].savings-options[0].savings)/1.5;
 const incrementalMediumToLarge=(options[2].savings-options[1].savings)/2.5;
 assert.ok(incrementalMediumToLarge<=incrementalSmallToMedium+1);
});
