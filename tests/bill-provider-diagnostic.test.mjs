import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet,providerFailure} from '../functions/api/read-bill.js';
const hostname='hec-fletcher-privacy.solectrics-jobhub-staging.pages.dev';
function context(host=hostname,flags={JOBHUB_STAGING_ONLY:'true',ALLOW_PAGES_DEV_HOST:'true'}) {
 return {request:new Request(`https://${host}/api/read-bill?diagnostic=provider`),env:{...flags,OPENAI_API_KEY:'synthetic-secret',get DB(){throw Error('No database access');},get JOB_FILES(){throw Error('No storage access');}}};
}
test('recovery removes temporary provider diagnostic without database, storage or provider access',async()=>{
 const old=globalThis.fetch;globalThis.fetch=()=>{throw Error('Unexpected provider access');};
 try {assert.equal((await onRequestGet(context())).status,404);} finally {globalThis.fetch=old;}
});
test('provider rejection distinguishes configuration, permissions, quota and request failures without reflecting provider text',()=>{
 for(const [status,code,category] of [[401,'invalid_api_key','credentials'],[403,'unknown','permissions'],[429,'insufficient_quota','quota'],[429,'rate_limit_exceeded','rate_limit'],[404,'model_not_found','model_access'],[400,'invalid_request','request'],[503,'unknown','provider_unavailable'],[418,'PRIVATE CUSTOMER synthetic-secret','unclassified']]) {
  const value=providerFailure(status,code);assert.equal(value.category,category);assert.doesNotMatch(JSON.stringify(value),/PRIVATE|synthetic-secret/);
 }
});

test('real extraction rejection logs only controlled status/category, never retries or reflects provider details',async()=>{
 const {onRequestPost}=await import('../functions/api/read-bill.js');
 const oldFetch=globalThis.fetch,oldError=console.error;let calls=0;const logs=[];
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{code:'insufficient_quota',message:'PRIVATE CUSTOMER synthetic-secret',param:'private-account'}}),{status:429});};
 console.error=(...args)=>logs.push(args);
 try {const form=new FormData();form.append('bill',new File([new Uint8Array([1,2])],'synthetic.png',{type:'image/png'}));const response=await onRequestPost({request:new Request('https://synthetic.invalid/api/read-bill',{method:'POST',body:form}),env:{OPENAI_API_KEY:'synthetic-secret'}});assert.equal(response.status,502);assert.match(await response.text(),/no available quota/);assert.equal(calls,1);assert.deepEqual(logs,[['Bill-reading provider rejected the request.',{status:429,category:'quota'}]]);assert.doesNotMatch(JSON.stringify(logs),/PRIVATE|synthetic-secret|private-account/);}finally{globalThis.fetch=oldFetch;console.error=oldError;}
});
