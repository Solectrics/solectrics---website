import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet,providerFailure} from '../functions/api/read-bill.js';
const hostname='hec-fletcher-privacy.solectrics-jobhub-staging.pages.dev';
function context(host=hostname,flags={JOBHUB_STAGING_ONLY:'true',ALLOW_PAGES_DEV_HOST:'true'}) {
 return {request:new Request(`https://${host}/api/read-bill?diagnostic=provider`),env:{...flags,OPENAI_API_KEY:'synthetic-secret',get DB(){throw Error('No database access');},get JOB_FILES(){throw Error('No storage access');}}};
}
test('provider diagnostic is exact-host and explicitly staging-only; denied calls make no provider request',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Must not call');};
 try {for(const c of [context('solectrics.co.nz'),context('www.solectrics.co.nz'),context(`unapproved.${hostname}`),context(hostname,{}),context(hostname,{JOBHUB_STAGING_ONLY:'true',ALLOW_PAGES_DEV_HOST:'false'})]) assert.equal((await onRequestGet(c)).status,404);assert.equal(calls,0);}finally{globalThis.fetch=old;}
});
test('provider diagnostic reads only model metadata and exposes no key or provider payload',async()=>{
 const old=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({error:{code:'insufficient_quota',message:'PRIVATE CUSTOMER synthetic-secret'}}),{status:429});};
 try {const response=await onRequestGet(context());const text=await response.text();assert.doesNotMatch(text,/PRIVATE|synthetic-secret|CUSTOMER/);assert.equal(JSON.parse(text).category,'quota');assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.openai.com/v1/models/gpt-5.6');assert.equal(calls[0].options.method,undefined);assert.equal(calls[0].options.body,undefined);}finally{globalThis.fetch=old;}
});
test('missing key never calls provider; successful metadata is not presented as extraction/quota acceptance',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response('{}');};
 try {const c=context();delete c.env.OPENAI_API_KEY;assert.equal((await (await onRequestGet(c)).json()).category,'missing_configuration');assert.equal(calls,0);const good=await (await onRequestGet(context())).json();assert.match(good.limitation,/Does not verify Responses permission, billing or quota/);assert.equal(calls,1);}finally{globalThis.fetch=old;}
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
