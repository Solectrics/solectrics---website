import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from 'node:fs';import {execFileSync}from 'node:child_process';
import {onRequestPost,sanitise}from '../functions/api/read-bill.js';
for(const [season,days,kwh,electricity]of [['summer',31,430,197.86],['winter',30,1040,413.89]])test(`synthetic ${season} PDF bytes reach provider unchanged; structured response excludes broadband`,async()=>{
 const path=new URL(`./fixtures/hec-pdfs/${season}.pdf`,import.meta.url);const bytes=readFileSync(path);
 const text=execFileSync('pdftotext',[path.pathname,'-'],{encoding:'utf8'});assert.match(text,new RegExp(`${kwh} kWh`));assert.match(text,/FICTIONAL BILL/);
 const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');const payload=JSON.parse(options.body);const part=payload.input[0].content.find(x=>x.type==='input_file');assert.deepEqual(Buffer.from(part.file_data.split(',')[1],'base64'),bytes);
  assert.match(payload.input[0].content[0].text,/cumulative meter/);
  return Response.json({output_text:JSON.stringify({billing_days:days,total_import_kwh:kwh,electricity_total_incl_gst_nzd:electricity,broadband_total_incl_gst_nzd:90,total_bill_nzd:electricity+90,needs_review_fields:['import_rate_cents','daily_fixed_charge_cents']})});
 };
 try{const form=new FormData();form.set('bill',new File([bytes],`${season}.pdf`,{type:'application/pdf'}));const r=await onRequestPost({request:new Request('http://localhost/api/read-bill',{method:'POST',body:form}),env:{OPENAI_API_KEY:'synthetic-not-sent'}});assert.equal(r.status,200);const b=await r.json();assert.equal(b.total_import_kwh,kwh);assert.equal(b.electricity_total_incl_gst_nzd,electricity);assert.equal(b.billing_days,days);assert.equal(b.import_rate_cents,null);assert.ok(b.needs_review_fields.includes('import_rate_gst_basis'));}finally{globalThis.fetch=original;}
});
test('uncertain dates, totals and nonnumeric consumption fail closed',()=>{
 for(const value of [true,[],[430],'$430','430 kWh',-1])assert.equal(sanitise({total_import_kwh:value}).total_import_kwh,null);
 const b=sanitise({billing_period_start:'2026-07-30',billing_period_end:'2026-07-01',billing_days:30,electricity_total_incl_gst_nzd:300,broadband_total_incl_gst_nzd:90,total_bill_nzd:300});assert.equal(b.billing_days,null);assert.equal(b.electricity_total_incl_gst_nzd,null);
});
