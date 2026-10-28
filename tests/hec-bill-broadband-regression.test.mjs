import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sanitise} from '../functions/api/read-bill.js';
import {deriveBaseline,deriveCurrentPlan} from '../functions/api/energy-review.js';
import {buildEnergyComparison} from '../functions/api/customer-quotes.js';
const html=await readFile(new URL('../home-energy-check.html',import.meta.url),'utf8');

const electricityOnly={
 retailer:'Synthetic',billing_days:31,total_import_kwh:800,average_daily_kwh:25.8,
 total_bill_nzd:645.16,electricity_charges_nzd:555.16,
 non_electricity_charges_nzd:90,electricity_cost_separation_status:'separated',
 daily_fixed_charge_cents:249.9,daily_fixed_charge_gst_basis:'inclusive',
 import_rate_cents:26.91,import_rate_gst_basis:'inclusive'
};
test('mixed electricity/broadband bill uses only electricity charges',()=>{
 const answers={bills:{summer:electricityOnly,winter:null}};
 const baseline=deriveBaseline(answers,[]);
 assert.equal(baseline.annual_expenditure_nzd,Math.round(555.16/31*365));
 assert.ok(baseline.annual_expenditure_nzd<Math.round(645.16/31*365));
 const graph=buildEnergyComparison(answers,{estimated_generation_kwh:5000});
 assert.ok(graph&&graph.current.every(Number.isFinite));
 assert.ok(graph.current[0] < 645.16/31*30.4375);
});
test('unseparated broadband-only notes never turn whole invoice into electricity expenditure',()=>{
 const bill={...electricityOnly,electricity_charges_nzd:null,non_electricity_charges_nzd:null,
  electricity_cost_separation_status:null,other_tariff_information:'Broadband charge: NZD 78',
  total_import_kwh:800};
 const baseline=deriveBaseline({bills:{summer:bill}},[]);
 assert.equal(baseline.annual_expenditure_nzd,null);
 const graph=buildEnergyComparison({bills:{summer:bill}},{estimated_generation_kwh:5000});
 assert.ok(graph);
 assert.ok(graph.current[0]<645.16);
});
test('an unknown non-electricity split is never silently filled',()=>{
 const bill={...electricityOnly,electricity_charges_nzd:null,
  electricity_cost_separation_status:'needs_review'};
 assert.equal(deriveBaseline({bills:{winter:bill}},[]).annual_expenditure_nzd,null);
});
test('existing electricity-only bills retain legacy total fallback',()=>{
 const bill={billing_days:30,total_import_kwh:650,total_bill_nzd:240,
  daily_fixed_charge_cents:100,import_rate_cents:30};
 assert.equal(deriveBaseline({bills:{summer:bill}},[]).annual_expenditure_nzd,2920);
});
test('GST-exclusive import and fixed charges are multiplied once',()=>{
 const bill={import_rate_cents:23.4,import_rate_gst_basis:'exclusive',
   daily_fixed_charge_cents:249.9,daily_fixed_charge_gst_basis:'exclusive'};
 const plan=deriveCurrentPlan({bills:{winter:bill}});
 assert.ok(Math.abs(plan.standard_import_rate_cents-26.91)<.000001);
 assert.ok(Math.abs(plan.daily_charge_cents-287.385)<.000001);
});
test('invalid charged/free kWh split requires manual review',()=>{
 const bill=sanitise({total_import_kwh:900,charged_import_kwh:750,free_import_kwh:100,needs_review_fields:[]});
 assert.equal(bill.charged_import_kwh,null);
 assert.equal(bill.free_import_kwh,null);
 assert.ok(bill.needs_review_fields.includes('charged_import_kwh'));
});
test('new PDF review fields and free-electricity disclaimer exist without replacing annual editor',()=>{
 assert.match(html,/electricity_charges_nzd/);
 assert.match(html,/daily_fixed_charge_gst_basis/);
 assert.match(html,/FREE-ELECTRICITY TARIFF — SAVINGS ARE INDICATIVE/);
 assert.match(html,/makeConfirmedAnnualReview/);
});
