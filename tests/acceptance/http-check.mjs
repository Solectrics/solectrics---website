import assert from 'node:assert/strict';import {readFileSync}from 'node:fs';
const base='http://127.0.0.1:8766';
const state=async()=>await(await fetch(base+'/__state')).json();
const reset=async()=>fetch(base+'/__reset',{method:'POST'});
const send=async(action,files=true)=>{
 const f=new FormData();f.set('answers',JSON.stringify({name:'Synthetic acceptance',email:'acceptance@example.invalid',followUpRequest:action,customerCopyOptIn:false}));
 if(files)for(const season of ['summer','winter'])f.set(season+'_bill',new File([readFileSync(new URL('../fixtures/hec-pdfs/'+season+'.pdf',import.meta.url))],season+'.pdf',{type:'application/pdf'}));
 return fetch(base+'/api/enquiry',{method:'POST',body:f});
};
await reset();
for(const season of ['summer','winter']){const f=new FormData();f.set('bill',new File([readFileSync(new URL('../fixtures/hec-pdfs/'+season+'.pdf',import.meta.url))],season+'.pdf',{type:'application/pdf'}));const r=await fetch(base+'/api/read-bill',{method:'POST',body:f});assert.equal(r.status,200);assert.equal((await r.json()).broadband_total_incl_gst_nzd,90);}
const email=()=>fetch(base+'/api/hec-email-results',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token:'synthetic-token:127.0.0.1',answers:{name:'Synthetic',email:'acceptance@example.invalid'}})});
assert.equal((await email()).status,200);assert.equal((await state()).jobs,0);assert.equal((await state()).enquiries,0);assert.equal((await state()).emails,1);
assert.equal((await email()).status,429);
assert.equal((await send('review')).status,200);assert.equal((await send('free_site_visit')).status,200);
let s=await state();assert.equal(s.jobs,2);assert.equal(s.files,4);assert.equal(s.emails,1);assert.match(s.nextActions[1].next_action,/free site visit/);
await reset();await fetch(base+'/__mode?value=upload-failure',{method:'POST'});assert.equal((await send('review')).status,500);s=await state();assert.equal(s.jobs,0);assert.equal(s.enquiries,0);assert.equal(s.objects,0);
await reset();assert.equal((await send('review',false)).status,200);assert.equal((await state()).files,0);
console.log('HTTP acceptance passed: fictional PDFs, all three choices, throttling, failed uploads, optional bills. All services simulated.');
