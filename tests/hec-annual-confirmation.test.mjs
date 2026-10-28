import test from 'node:test';
import assert from 'node:assert/strict';
import {makeConfirmedAnnualReview} from '../assets/hec-annual-review-data.mjs';
import {reviewMonthlyBillSummary,reviewMonthlyRows} from '../assets/hec-annual-usage-reader.mjs';
import {sanitiseAnnualUsageReview} from '../functions/api/_hec-annual-review.js';

const file={name:'synthetic-bill-summary.xlsx',size:4378};
const summaryRows=[
  ['12 months of bills'],
  ...['Oct','Sep','Aug','Jul','Jun','May','Apr','Mar','Feb','Jan','Dec','Nov'].map((month,i)=>[month,200+i]),
  ['Notes','Monthly broadband charge of $90; we were overseas']
];
const summary=reviewMonthlyBillSummary(summaryRows);
function confirmedSummary(){
  return makeConfirmedAnnualReview(summary,summary.months.map(m=>({combinedBillNzd:String(m.combinedNzd)})),file,'2026-10-29T00:00:00.000Z');
}
test('summary correction saves only combined dollar amounts and recomputes totals',()=>{
  const rows=summary.months.map(m=>({combinedBillNzd:m.combinedNzd}));
  rows[0].combinedBillNzd=250;
  const confirmed=makeConfirmedAnnualReview(summary,rows,file);
  const stored=sanitiseAnnualUsageReview(confirmed,[file],'2026-10-29T01:00:00.000Z');
  assert.equal(stored.status,'user_confirmed');
  assert.equal(stored.totals.combinedBillNzd,2516);
  assert.equal(stored.totals.kwh,null);
  assert.equal(stored.totals.electricityNzd,null);
  assert.equal(stored.verifiedForModel,false);
  assert.equal(stored.confirmedAt,'2026-10-29T01:00:00.000Z');
  assert.equal(stored.flags.yearUnknown,true);
});
test('edited blanks and negative amounts cannot be confirmed',()=>{
  const rows=summary.months.map(m=>({combinedBillNzd:String(m.combinedNzd)}));
  rows[5].combinedBillNzd='';
  assert.throws(()=>makeConfirmedAnnualReview(summary,rows,file),/Enter a bill amount/);
  rows[5].combinedBillNzd='-15';
  assert.throws(()=>makeConfirmedAnnualReview(summary,rows,file),/non-negative/);
});
test('review must match selected attached spreadsheet',()=>{
  const confirmed=confirmedSummary();
  assert.equal(sanitiseAnnualUsageReview(confirmed,[{name:file.name,size:9999}]),false);
  assert.equal(sanitiseAnnualUsageReview(confirmed,[{name:'different.xlsx',size:file.size}]),false);
  assert.ok(sanitiseAnnualUsageReview(confirmed,[file]));
});
test('server ignores forged client totals and retains unverified flags',()=>{
  const forged={...confirmedSummary(),totals:{combinedBillNzd:999999,electricityNzd:999999,kwh:999999},verifiedForModel:false};
  const stored=sanitiseAnnualUsageReview(forged,[file]);
  assert.equal(stored.totals.combinedBillNzd,2466);
  assert.equal(stored.totals.kwh,null);
  assert.equal(stored.totals.electricityNzd,null);
});
test('optional review has no impact on ordinary file submission',()=>{
  assert.equal(sanitiseAnnualUsageReview(null,[file]),null);
  assert.equal(sanitiseAnnualUsageReview(undefined,[file]),null);
});
test('structured review keeps explicit units, dates and GST uncertainty',()=>{
  const rows=[['Month','kWh','Electricity Cost','Broadband'],
    ...Array.from({length:12},(_,i)=>[`2025-${String(i+1).padStart(2,'0')}`,'200','140','60'])];
  const initial=reviewMonthlyRows(rows);
  const source={name:'synthetic.csv',size:1252};
  const confirmed=makeConfirmedAnnualReview(initial,initial.months.map(m=>({...m,gstBasis:'unknown'})),source);
  const stored=sanitiseAnnualUsageReview(confirmed,[source]);
  assert.equal(stored.totals.kwh,2400);
  assert.equal(stored.totals.electricityNzd,1680);
  assert.equal(stored.months[0].broadbandNzd,60);
  assert.equal(stored.flags.electricityCostUnverified,true);
  assert.equal(stored.verifiedForModel,false);
});
test('server rejects fabricated row dates, missing months or model-ready flags',()=>{
  const base=confirmedSummary();
  assert.equal(sanitiseAnnualUsageReview({...base,verifiedForModel:true},[file]),false);
  assert.equal(sanitiseAnnualUsageReview({...base,months:base.months.slice(0,11)},[file]),false);
  const dup=base.months.map(m=>({...m}));
  dup[1].monthLabel=dup[0].monthLabel;
  assert.equal(sanitiseAnnualUsageReview({...base,months:dup},[file]),false);
});
