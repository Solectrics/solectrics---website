import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost} from '../functions/api/fletcher-email.js';

const fixture=role=>({id:role,document_role:role,storage_key:role,original_name:`synthetic-${role}.pdf`,size_bytes:10});
async function scenario(files,{missingObject=null,approve=true,mutate=false}={}) {
 const emails=[],reads=[];const oldFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');emails.push(JSON.parse(options.body));return Response.json({id:'synthetic-message'});};
 const db={prepare(sql){return {bind(){return this;},run:async()=>({}),first:async()=>({job_id:7,customer_name:'Synthetic Customer',address:'Synthetic site'}),all:async()=>({results:sql.startsWith('PRAGMA')?[{name:'document_role'},{name:'energy_data_detail'}]:files})};}};
 const env={DB:db,JOB_FILES:{get:async key=>{reads.push(key);return key===missingObject?null:{arrayBuffer:async()=>new Uint8Array([1]).buffer};}},RESEND_API_KEY:'test-only'};
 const request=body=>onRequestPost({env,request:new Request('https://example.test/api/fletcher-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:7,...body})})});
 try {
  const p=await request({action:'preview'}),preview=await p.json();
  assert.equal(emails.length,0,'preview never sends');assert.equal(reads.length,0,'preview never downloads attachments');
  if(!preview.ok)return {status:p.status,data:preview,emails,reads};
  if(mutate)files.unshift({...fixture('roof_layout'),id:'replacement',storage_key:'replacement'});
  const r=await request({approved_preview:approve?preview.preview_id:undefined});
  return {status:r.status,data:await r.json(),preview,emails,reads};
 }finally{globalThis.fetch=oldFetch;}
}
test('layout and generated PDF required; bill and SLD never mandatory',async()=>{
 for(const roles of [[],['fletcher_assessment'],['roof_layout'],['fletcher_assessment','power_bill']]) {
  const r=await scenario(roles.map(fixture));assert.equal(r.status,400);assert.equal(r.emails.length,0);
 }
 const r=await scenario(['fletcher_assessment','roof_layout'].map(fixture));assert.equal(r.status,200);
});
test('bill is excluded even when classified, named, oversized or unavailable',async()=>{
 const files=[fixture('power_bill'),{...fixture('additional_power_bill'),original_name:'electricity-bill.pdf'},
  {...fixture('general'),original_name:'customer-power-bill.pdf',size_bytes:50*1024*1024},fixture('roof_layout'),fixture('fletcher_assessment')];
 const r=await scenario(files,{missingObject:'power_bill'});assert.equal(r.status,200);
 assert.deepEqual(r.emails[0].attachments.map(a=>a.filename),['synthetic-fletcher_assessment.pdf','synthetic-roof_layout.pdf']);
 assert.ok(r.reads.every(key=>!key.includes('bill')));assert.deepEqual(r.emails[0].to,['jane@solectrics.co.nz']);
 assert.ok(r.preview.preview.attachments.every(a=>!a.role.includes('bill')));
});
test('SLD remains optional and is included when present',async()=>{
 const r=await scenario(['fletcher_assessment','roof_layout','sld'].map(fixture));assert.equal(r.status,200);
 assert.equal(r.emails[0].attachments.length,3);assert.deepEqual(r.data.missing,[]);
});
test('an electricity bill misclassified as a roof layout cannot be included',async()=>{
 const r=await scenario([fixture('fletcher_assessment'),{...fixture('roof_layout'),original_name:'customer-electricity-bill.pdf'}]);
 assert.equal(r.status,400);assert.equal(r.emails.length,0);assert.equal(r.reads.length,0);
});
test('no preview approval or changed attachment selection prevents sending',async()=>{
 for(const options of [{approve:false},{mutate:true}]){
  const r=await scenario(['fletcher_assessment','roof_layout'].map(fixture),options);assert.equal(r.status,409);assert.equal(r.emails.length,0);assert.equal(r.reads.length,0);
 }
});
test('required inaccessible or oversized layout prevents sending',async()=>{
 const files=['fletcher_assessment','roof_layout'].map(fixture);
 const absent=await scenario(files,{missingObject:'roof_layout'});assert.equal(absent.status,500);assert.equal(absent.emails.length,0);
 const huge=await scenario(files.map(f=>f.document_role==='roof_layout'?{...f,size_bytes:26*1024*1024}:f));assert.equal(huge.status,400);assert.equal(huge.emails.length,0);
});
