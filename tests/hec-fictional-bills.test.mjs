import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {onRequestPost} from "../functions/api/read-bill.js";

// Synthetic figures reproduced from the two fictional test PDFs.
// The model response is mocked: no customer data or PDF is sent to OpenAI.
const cases=[
 {season:"summer",days:31,kwh:430,electricity:197.86,broadband:90,combined:287.86,gst:25.81},
 {season:"winter",days:30,kwh:1040,electricity:413.89,broadband:90,combined:503.89,gst:53.99}
];
const html=await readFile(new URL("../home-energy-check.html",import.meta.url),"utf8");
const slice=(name,next)=>{
 const start=html.indexOf("function "+name+"(");
 const end=html.indexOf(next,start);
 assert.ok(start>=0 && end>start);
 return html.slice(start,end);
};
const ctx=vm.createContext({});
vm.runInContext([
 'function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}',
 slice("billNumber","function average("),
 slice("billingDays","function monthlyImport("),
 slice("monthlyBillCost","function importRateFromBill("),
 slice("seasonalProfile","function directionText("),
 slice("importRateFromBill","function exportRateFromBill("),
 slice("exportRateFromBill","function fixedMonthlyCharge("),
 slice("financialInputAudit","/* =========================================================\\n   SEASONAL DEMAND")
].join("\n"),ctx);

for(const sample of cases){
 test(`fictional ${sample.season}: reader excludes $90 broadband and does not double-count GST`,async()=>{
  const saved=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async(url,opts)=>{
   calls++;
   assert.equal(url,"https://api.openai.com/v1/responses");
   const body=JSON.parse(opts.body);
   assert.match(body.input[0].content[0].text,/electricity_total_incl_gst_nzd/);
   assert.equal(body.input[0].content[1].type,"input_file");
   return Response.json({output_text:JSON.stringify({
      billing_days:sample.days,total_import_kwh:sample.kwh,
      total_bill_nzd:sample.combined,
      electricity_total_incl_gst_nzd:sample.electricity,
      broadband_total_incl_gst_nzd:sample.broadband,
      gst_nzd:sample.gst,
      import_rate_cents:31,daily_fixed_charge_cents:125,
      confidence:0.98,needs_review_fields:[]
   })});
  };
  try{
   // The PDF payload is deliberately synthetic for this endpoint-integration test.
   const fakePdf=new File(["%PDF-1.4\nfictional test data"],`${sample.season}.pdf`,{type:"application/pdf"});
   const form=new FormData();form.append("bill",fakePdf);
   const response=await onRequestPost({
     request:new Request("https://test.invalid/api/read-bill",{method:"POST",body:form}),
     env:{OPENAI_API_KEY:"mock-key"}
   });
   assert.equal(response.status,200);
   const parsed=await response.json();
   assert.equal(parsed.electricity_total_incl_gst_nzd,sample.electricity);
   assert.equal(parsed.broadband_total_incl_gst_nzd,90);
   assert.equal(parsed.total_bill_nzd,sample.combined);
   assert.equal(parsed.gst_nzd,sample.gst);
   assert.equal(calls,1);
   const electricityPerMeanMonth=sample.electricity/sample.days*30.4375;
   assert.ok(Math.abs(vm.runInContext("monthlyBillCost",ctx)(parsed)-electricityPerMeanMonth)<1e-7);
   assert.ok(Math.abs(vm.runInContext("monthlyBillCost",ctx)(parsed)-sample.combined/sample.days*30.4375)>50);
  }finally{globalThis.fetch=saved;}
 });
}
test("fictional PDFs require more than two bills to validate savings forecast",()=>{
 assert.ok(html.includes('model.estimateSource === "household-benchmark"'));
 assert.match(html,/one-bill/);
 assert.match(html,/two-bills/);
});

test("fictional summer and winter electricity-only bills yield a plausible pre-solar baseline",()=>{
 const cost=vm.runInContext("monthlyBillCost",ctx);
 const summer=cost({billing_days:31,electricity_total_incl_gst_nzd:197.86,total_bill_nzd:287.86,broadband_total_incl_gst_nzd:90});
 const winter=cost({billing_days:30,electricity_total_incl_gst_nzd:413.89,total_bill_nzd:503.89,broadband_total_incl_gst_nzd:90});
 const season=vm.runInContext("seasonalProfile",ctx)(summer,winter);
 const baseline=Array.from(season).reduce((sum,v)=>sum+v,0);
 assert.ok(baseline>3000 && baseline<4000, "Seasonally extrapolated pre-solar baseline should reflect real electricity-only charges");
 // This is a regression cross-check, not a validated customer forecast.
 const inflated=Array.from(vm.runInContext("seasonalProfile",ctx)(
   287.86/31*30.4375,503.89/30*30.4375
 )).reduce((sum,v)=>sum+v,0);
 assert.ok(inflated-baseline>1000, "Broadband must not inflate the annual electricity baseline");
});
test("a dollar savings forecast stays blocked without verified tariff and site inputs",()=>{
 assert.match(html,/financialEstimateReady:\s*financialAudit\.ready/);
 assert.match(html,/DEFAULT_EXPORT_RATE = 0\.12/);
 assert.match(html,/BASE_ANNUAL_SOLAR = 6250/);
});

test("financial audit explains why fictional seasonal bills are not yet safe for a public savings forecast",()=>{
 const audit=vm.runInContext("financialInputAudit",ctx);
 const sample=(kwh,cost,days)=>({
    total_import_kwh:kwh,billing_days:days,
    electricity_total_incl_gst_nzd:cost,daily_fixed_charge_cents:125,
    import_rate_cents:31
 });
 const result=audit(sample(430,197.86,31),sample(1040,413.89,30));
 assert.equal(result.ready,false);
 assert.ok(result.issues.some(i=>i.includes("export buy-back tariff")));
 assert.ok(result.issues.some(i=>i.includes("GST inclusion")));
 assert.ok(result.issues.some(i=>i.includes("Roof-adjusted PV yield")));
});
