// Explicit nonproduction validation using ONLY committed fictional PDFs.
// OPENAI_API_KEY must already be supplied securely. Never print responses or keys.
import {readFileSync}from 'node:fs';
import assert from 'node:assert/strict';
import {onRequestPost}from '../functions/api/read-bill.js';
if(!process.env.OPENAI_API_KEY)throw Error('Nonproduction provider credential unavailable');
for(const [season,days,kwh,total]of [['summer',31,430,197.86],['winter',30,1040,413.89]]){
 const form=new FormData();form.set('bill',new File([readFileSync(new URL(`./fixtures/hec-pdfs/${season}.pdf`,import.meta.url))],`${season}.pdf`,{type:'application/pdf'}));
 const response=await onRequestPost({request:new Request('http://localhost/api/read-bill',{method:'POST',body:form}),env:{OPENAI_API_KEY:process.env.OPENAI_API_KEY}});
 assert.equal(response.status,200,'Provider extraction unsuccessful');const b=await response.json();
 assert.equal(b.billing_days,days);assert.equal(b.total_import_kwh,kwh);assert.ok(Math.abs(b.electricity_total_incl_gst_nzd-total)<.02);assert.equal(b.broadband_total_incl_gst_nzd,90);assert.equal(b.import_rate_cents,null);console.log(`${season}: fictional extraction passed`);
}
