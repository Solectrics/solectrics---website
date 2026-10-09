import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/fletcher-email.js';

const fixture = role => ({id:role,document_role:role,storage_key:role,original_name:`synthetic-${role}.pdf`,size_bytes:10});
async function request(files, missingObject = null) {
  const emails=[];
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{emails.push(JSON.parse(options.body));return Response.json({id:'synthetic-message'});};
  const db={prepare(sql){return {bind(){return this;},run:async()=>({}),first:async()=>({job_id:7,customer_name:'Synthetic Customer'}),all:async()=>({results:sql.startsWith('PRAGMA')?[{name:'document_role'},{name:'energy_data_detail'}]:files})};}};
  try {
    const response=await onRequestPost({env:{DB:db,JOB_FILES:{get:async key=>key===missingObject?null:{arrayBuffer:async()=>new Uint8Array([1]).buffer}},RESEND_API_KEY:'synthetic-test-key'},request:new Request('https://example.test/api/fletcher-email',{method:'POST',body:JSON.stringify({job_id:7})})});
    return {status:response.status,data:await response.json(),emails};
  } finally {globalThis.fetch=oldFetch;}
}
test('backend refuses packages missing the bill or layout without sending',async()=>{
  for(const roles of [['fletcher_assessment'],['fletcher_assessment','power_bill'],['fletcher_assessment','roof_layout']]){
    const result=await request(roles.map(fixture));assert.equal(result.status,400);assert.equal(result.emails.length,0);
  }
});
test('backend attaches the latest bill and layout to Jane, with SLD optional',async()=>{
  const newest={...fixture('roof_layout'),storage_key:'new-layout',original_name:'new-layout.png'};
  const result=await request([newest,fixture('fletcher_assessment'),fixture('power_bill'),fixture('roof_layout')]);
  assert.equal(result.data.ok,true);assert.equal(result.emails.length,1);
  assert.deepEqual(result.emails[0].to,['jane@solectrics.co.nz']);
  assert.deepEqual(result.emails[0].attachments.map(a=>a.filename),['synthetic-fletcher_assessment.pdf','new-layout.png','synthetic-power_bill.pdf']);
  assert.deepEqual(result.data.missing,['Single-line diagram (SLD)']);
});
test('required unavailable or oversized attachment prevents sending',async()=>{
  const files=['fletcher_assessment','roof_layout','power_bill'].map(fixture);
  for(const role of ['roof_layout','power_bill']){
    const unavailable=await request(files,role);assert.equal(unavailable.emails.length,0);assert.equal(unavailable.status,500);
    const oversized=await request(files.map(f=>f.document_role===role?{...f,size_bytes:26*1024*1024}:f));assert.equal(oversized.emails.length,0);assert.equal(oversized.status,400);
  }
});
