import test from "node:test";
import assert from "node:assert/strict";
import {parseCsv,reviewMonthlyRows} from "../assets/hec-annual-usage-reader.mjs";

const rows = (headers, build) => [
  headers,
  ...Array.from({length:12},(_,i)=>build(i, `2025-${String(i+1).padStart(2,"0")}`))
];

test("reads 12 months of explicitly labelled kWh without inventing dollar costs",()=>{
  const data=rows(["Month","Electricity kWh"],(i,m)=>[m,String(200+i)]);
  const r=reviewMonthlyRows(data);
  assert.equal(r.months.length,12);
  assert.equal(r.totals.kwh,2466);
  assert.equal(r.totals.electricityNzd,null);
  assert.equal(r.verifiedForModel,false);
});
test("keeps broadband and combined bill totals out of electricity-only cost",()=>{
  const data=rows(["Month","Total","Broadband"],(i,m)=>[m,"$300","$60"]);
  const r=reviewMonthlyRows(data);
  assert.equal(r.totals.electricityNzd,null);
  assert.equal(r.months[0].broadbandNzd,60);
  assert.match(r.warnings.join(" "),/Combined bill total/);
});
test("electricity-only dollars remain dollars, not kWh",()=>{
  const data=rows(["Month","Electricity Cost","GST Basis"],(i,m)=>[m,"$240.50","inclusive"]);
  const r=reviewMonthlyRows(data);
  assert.equal(r.totals.kwh,null);
  assert.equal(r.totals.electricityNzd,2886);
  assert.equal(r.status,"ready_for_review");
});
test("unknown GST basis is flagged rather than assumed",()=>{
  const data=rows(["Month","Electricity Cost"],(i,m)=>[m,"$100"]);
  const r=reviewMonthlyRows(data);
  assert.equal(r.status,"needs_review");
  assert.match(r.warnings.join(" "),/GST basis/);
});
test("duplicate or missing months cannot pass review",()=>{
  const data=rows(["Month","kWh"],(i,m)=>[i===11?"2025-11":m,"200"]);
  const r=reviewMonthlyRows(data);
  assert.equal(r.status,"needs_review");
  assert.match(r.warnings.join(" "),/Duplicate month/);
});
test("quoted CSV cells and escaped quotes are handled",()=>{
  const rows=parseCsv('Month,Electricity Cost,Notes\n2025-01,"$1,200.50","said ""ok"""\n');
  assert.deepEqual(rows[1],["2025-01","$1,200.50",'said "ok"']);
});
test("invalid numeric values are not silently coerced",()=>{
  const data=rows(["Month","kWh"],(i,m)=>[m,i===4?"$NA":"300"]);
  const r=reviewMonthlyRows(data);
  assert.equal(r.totals.kwh,null);
  assert.match(r.warnings.join(" "),/Invalid kWh/);
});
