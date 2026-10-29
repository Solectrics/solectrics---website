import test from 'node:test';import assert from 'node:assert/strict';
import {onRequestPost} from '../functions/api/hec-email-results.js';
import guard from '../services/hec-email-guard/worker.js';
import {renderHomeEnergyCheckCopy} from '../functions/api/_hec-customer-copy.js';
const request=(payload={answers:{email:'test@example.invalid',name:'Synthetic'},token:'test-token'},headers={})=>new Request('https://example.invalid/api/hec-email-results',{method:'POST',headers:{Origin:'https://example.invalid','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',...headers},body:typeof payload==='string'?payload:JSON.stringify(payload)});
const env=()=>({RESEND_API_KEY:'synthetic',HEC_TURNSTILE_SECRET:'synthetic',HEC_EMAIL_GUARD:{fetch:async()=>new Response(null,{status:204})}});
test('email rejects missing protections, foreign origins, invalid payloads and oversized streams before provider calls',async()=>{
 let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error('must not call');};
 try{
  for(const [req,e,status]of [[request(),{},503],[request(undefined,{Origin:'https://evil.invalid'}),env(),403],[request('{'),env(),400],[request({answers:[],token:'x'}),env(),400],[request({answers:{email:'bad\r\nbcc@example.invalid'},token:'x'}),env(),400],[request({answers:{email:'test@example.invalid',name:{html:'x'}},token:'x'}),env(),400],[request({answers:{email:'test@example.invalid'}}),env(),400],[request('x'.repeat(16001)),env(),413]])assert.equal((await onRequestPost({request:req,env:e})).status,status);
  assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});
test('email limiter denial and failure prevent delivery; unverified, wrong-host and wrong-action tokens are rejected',async()=>{
 const original=globalThis.fetch;let sent=0;
 try{
  for(const status of [429,503]){const e=env();e.HEC_EMAIL_GUARD.fetch=async()=>new Response(null,{status});globalThis.fetch=async()=>{sent++;throw Error('unexpected');};assert.equal((await onRequestPost({request:request(),env:e})).status,status);}
  for(const result of [{success:false},{success:true,hostname:'evil.invalid',action:'hec-email'},{success:true,hostname:'example.invalid',action:'other'}]){
   globalThis.fetch=async url=>{assert.match(url,/siteverify/);return Response.json(result);};assert.equal((await onRequestPost({request:request(),env:env()})).status,403);
  }
  assert.equal(sent,0);
 }finally{globalThis.fetch=original;}
});
test('guard enforces three independent limits using hashed keys and fails closed',async()=>{
 const keys=[],limits={};for(const name of ['GLOBAL_LIMIT','IP_LIMIT','RECIPIENT_LIMIT'])limits[name]={limit:async({key})=>{keys.push([name,key]);return {success:true};}};
 const r=()=>new Request('https://internal/check',{method:'POST',body:JSON.stringify({ip:'a'.repeat(64),recipient:'b'.repeat(64)})});
 assert.equal((await guard.fetch(r(),limits)).status,204);assert.equal(keys.length,3);
 limits.RECIPIENT_LIMIT.limit=async()=>({success:false});assert.equal((await guard.fetch(r(),limits)).status,429);
 assert.equal((await guard.fetch(r(),{})).status,503);
});
test('client-supplied readiness flag cannot restore dollar forecasts in any email',()=>{
 const html=renderHomeEnergyCheckCopy({hecReportSummary:{financialEstimateReady:true,estimateSource:'two-bills',currentAnnualNzd:98765,solarAnnualNzd:87654,smartAnnualNzd:76543,batteryAnnualNzd:65432}});
 assert.doesNotMatch(html,/98,765|87,654|76,543|65,432|indicative electricity-cost comparison/);
});
test('provider failures do not create records, leak provider messages or retry email',async()=>{
 const original=globalThis.fetch;const originalError=console.error;console.error=()=>{};
 try{for(const failure of ['reject','network']){let emails=0;
 globalThis.fetch=async url=>{if(String(url).includes('siteverify'))return Response.json({success:true,hostname:'example.invalid',action:'hec-email'});emails++;if(failure==='network')throw Error('private provider detail');return new Response('private provider detail',{status:403});};
 const e=env();e.DB=new Proxy({},{get(){assert.fail('email-only must not access DB');}});e.JOB_FILES=new Proxy({},{get(){assert.fail('email-only must not access R2');}});
 const r=await onRequestPost({request:request(),env:e});assert.equal(r.status,502);assert.equal(emails,1);assert.doesNotMatch(await r.text(),/private provider detail/);
 }}finally{globalThis.fetch=original;console.error=originalError;}
});
