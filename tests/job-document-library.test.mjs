import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {onRequestGet} from '../functions/api/job-document-inventory.js';
const sandbox={};vm.runInNewContext(await readFile(new URL('../assets/job-document-library.js',import.meta.url),'utf8'),sandbox);
const {packageStatus,group}=sandbox.JobDocumentLibrary;
const file=(role,props={})=>({id:role,document_role:role,original_name:role+'.pdf',category:'other',accessibility:'accessible',...props});
test('package requirements depend on explicit request context; SLD is optional',()=>{
 assert.ok(packageStatus([],false).every(c=>c.status==='optional'));
 const required=packageStatus([],true);assert.equal(required.filter(c=>c.status==='missing').length,3);assert.equal(required.find(c=>c.role==='sld').status,'optional');
});
test('accessible explicit attachment is received; ticked design fields cannot satisfy absence',()=>{
 const checks=packageStatus([file('power_bill')],true);assert.equal(checks[0].status,'received');assert.equal(checks.find(c=>c.role==='roof_layout').status,'missing');
});
test('unavailable, inferred and latest-unverified files need review, not receipt',()=>{
 for(const props of [{accessibility:'unknown'},{accessibility:'unavailable'},{document_role:'general',original_name:'roof-layout.png'}])assert.equal(packageStatus([file('roof_layout',props)],true).find(c=>c.role==='roof_layout').status,'review');
 assert.equal(packageStatus([file('roof_layout',{accessibility:'unavailable'}),file('roof_layout')],true).find(c=>c.role==='roof_layout').status,'review');
});
test('grouping preserves general photos, certificates and unclassified files',()=>{
 assert.equal(group(file('general',{category:'roof'})),'Site Visit');assert.equal(group(file('certificate')),'Compliance');assert.equal(group(file('general')),'Other / Unclassified');
});
const host='https://fletcher-package-mobile-fix.solectrics-jobhub-staging.pages.dev';
function environment(rows){const statements=[],heads=[];return {statements,heads,env:{JOBHUB_STAGING_ONLY:'true',ALLOW_PAGES_DEV_HOST:'true',DB:{prepare(sql){statements.push(sql);assert.match(sql,/^SELECT /);return {bind(...args){return {all:async()=>({results:sql.includes('FROM jobs ')?[{id:7,job_type:'solar'}]:rows})}}}}},JOB_FILES:{head:async key=>{heads.push(key);if(key==='error')throw Error();return key==='missing'?null:{size:12}}}}}}
test('inventory uses SELECT and bounded HEAD only, never exposes storage keys',async()=>{
 const e=environment([file('power_bill',{job_id:7,storage_key:'ok'}),file('sld',{job_id:7,storage_key:'missing'}),file('roof_layout',{job_id:7,storage_key:'error'})]);
 const r=await onRequestGet({request:new Request(host+'/api/job-document-inventory?job_id=7'),env:e.env});const d=await r.json();assert.equal(r.status,200);assert.equal(e.statements.length,2);assert.deepEqual(d.jobs[0].files.map(f=>f.accessibility),['accessible','unavailable','unknown']);assert.ok(d.jobs[0].files.every(f=>!('storage_key'in f)));
});
test('production hostname, absent flags and malformed IDs stop before any storage access',async()=>{
 for(const [url,flags]of [['https://solectrics.co.nz/api/job-document-inventory?job_id=7',{}],[host+'/api/job-document-inventory?job_id=7',{JOBHUB_STAGING_ONLY:'false'}],[host+'/api/job-document-inventory?job_id=0',{}]]){const e=environment([]);Object.assign(e.env,flags);const r=await onRequestGet({request:new Request(url),env:e.env});assert.ok([400,404].includes(r.status));assert.equal(e.statements.length,0);assert.equal(e.heads.length,0);}
});
test('large inventories leave unchecked objects unverified and cap HEAD requests',async()=>{
 const e=environment(Array.from({length:205},(_,i)=>file('general',{id:String(i),job_id:7,storage_key:String(i)})));const d=await (await onRequestGet({request:new Request(host+'/api/job-document-inventory?job_id=7'),env:e.env})).json();assert.equal(e.heads.length,200);assert.equal(d.jobs[0].files.filter(f=>f.accessibility==='unknown').length,5);
});
