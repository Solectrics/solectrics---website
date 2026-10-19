import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HEC_FIELDS} from '../assets/hec-fields.mjs';
import {onRequestGet as get,onRequestPost as post} from '../functions/api/job-hec.js';
import {onRequestGet as energyGet,deriveBaseline} from '../functions/api/energy-review.js';
import {resolveElectricityDetails} from '../functions/api/_job-electricity-details.js';
import {onRequestPost as designPost} from '../functions/api/system-design.js';
import {onRequestGet as operationsGet,onRequestPost as operationsPost} from '../functions/api/job-tasks.js';
import {syntheticDb,seedJobs} from './helpers/synthetic-db.mjs';
function fixture(){const f=syntheticDb();seedJobs(f.sql);return f;}
const ctx=(f,body,url='http://localhost/api/job-hec?job_id=9101',flag='true')=>({env:{DB:f.db,JOBHUB_USABILITY_LOCAL_ONLY:flag},request:new Request(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
const load=async f=>(await get(ctx(f))).json();
async function save(f,patch={},extra={}){const current=await load(f);return post(ctx(f,{job_id:9101,patch,revision:current.revision,reason:'Synthetic staff correction',approved:true,...extra}));}
const raw=f=>f.sql.prepare('SELECT answers_json FROM enquiries WHERE id=9101').get().answers_json;
const bill={retailer:'Example Energy',plan_name:'Example Plan',icp:'000000000AA000A',billing_days:30,total_import_kwh:600,charged_import_kwh:500,free_import_kwh:100,total_bill_nzd:210,electricity_charges_nzd:180,non_electricity_charges_nzd:30,electricity_cost_separation_status:'separated',import_rate_cents:25,import_rate_gst_basis:'inclusive'};
test('all original question keys and conditional options remain editable',()=>{
 const html=readFileSync(new URL('../home-energy-check.html',import.meta.url),'utf8');const map=new Map(HEC_FIELDS.map(f=>[f.key,f]));
 for(const [,key,value]of html.matchAll(/(?:single|multi|selectWithin)\('([^']+)','([^']+)'/g)){assert.ok(map.has(key),key);assert.ok(map.get(key).options.includes(value),key+': '+value);}
 for(const key of ['dayHome','hotWater','evDayHome','cylinderSize','cylinderCondition','hotWaterControl','existingSolar','batteryInterest','roof','direction','shade','householdPersona','meter_number','meter_type','meter_notes','icp','retailer','plan_name','annual_kwh'])assert.ok(map.has(key),key);
});
test('each editable field survives a genuine existing-job round trip with full history and no duplicate records',async()=>{
 const f=fixture(),original=JSON.parse(raw(f));let count=0;
 for(const field of HEC_FIELDS){let value=field.type==='multi'?field.options.slice(0,2):field.options?field.options.at(-1):field.type==='number'?0:field.key==='email'?'updated@example.invalid':field.key==='icp'?'000000000AA000A':'Synthetic '+field.key;
 const response=await save(f,{[field.key]:value});assert.equal(response.status,200,field.key+': '+await response.clone().text());const result=await load(f);assert.deepEqual(result.values[field.key],value,field.key);count++;
 }
 const current=JSON.parse(raw(f));assert.deepEqual(current.hec_audit.original,original);assert.equal(current.hec_audit.history.length,count);assert.deepEqual(current.legacyUnknown,{retain:true});
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM jobs').get().n,2);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM enquiries').get().n,2);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM job_files').get().n,0);
 assert.equal(f.sql.prepare('SELECT customer_name FROM enquiries WHERE id=9101').get().customer_name,'Synthetic name');
 assert.equal(f.sql.prepare('SELECT answers_json FROM enquiries WHERE id=9102').get().answers_json,'{}');
});
test('conditional values survive changing parent answers; null and zero stay distinct',async()=>{
 const f=fixture();await save(f,{cylinderSize:'180–250 litres',evDayHome:'Usually',annual_kwh:0});await save(f,{hotWater:'Gas',loads:[]});const a=JSON.parse(raw(f));assert.equal(a.cylinderSize,'180–250 litres');assert.equal(a.evDayHome,'Usually');assert.equal(a.annual_kwh,0);await save(f,{annual_kwh:null});assert.equal(JSON.parse(raw(f)).annual_kwh,null);
});
test('approval, validation, stale/repeated/concurrent writes and malformed legacy JSON fail without overwrites',async()=>{
 const f=fixture(),initial=await load(f),before=raw(f);let body={job_id:9101,revision:initial.revision,patch:{people:'4'},reason:'Synthetic',approved:false};assert.equal((await post(ctx(f,body))).status,400);assert.equal(raw(f),before);
 assert.equal((await save(f,{people:'99'})).status,400);assert.equal((await save(f,{customerCopyOptIn:true})).status,400);assert.equal((await save(f,{annual_kwh:-1})).status,400);
 body.approved=true;assert.equal((await post(ctx(f,body))).status,200);const saved=raw(f);assert.equal((await post(ctx(f,body))).status,409);assert.equal(raw(f),saved);
 const current=await load(f),oldPrepare=f.db.prepare;let collision=true;f.db.prepare=function(q){const s=oldPrepare(q);if(q.startsWith('UPDATE enquiries'))s.bind=()=>({run:async()=>({meta:{changes:0}})});return s;};
 assert.equal((await post(ctx(f,{...body,revision:current.revision,patch:{people:'5+'}}))).status,409);assert.equal(raw(f),saved);f.db.prepare=oldPrepare;
 for(const malformed of ['{broken','[]','null','true']){f.sql.prepare('UPDATE enquiries SET answers_json=? WHERE id=9101').run(malformed);assert.equal((await get(ctx(f))).status,409);assert.equal((await save(f,{people:'3'})).status,400);assert.equal(raw(f),malformed);}
});
test('local feature containment and parent-job/file relationships fail closed',async()=>{
 const f=fixture();for(const url of ['https://solectrics.co.nz/api/job-hec?job_id=9101','https://preview.pages.dev/api/job-hec?job_id=9101'])assert.equal((await get(ctx(f,null,url))).status,403);assert.equal((await get(ctx(f,null,undefined,'false'))).status,403);
 assert.equal((await get(ctx(f,null,'http://localhost/api/job-hec?job_id=9102'))).status,400);
 const before=raw(f);assert.equal((await save(f,{}, {bill:{slot:'summer',file_id:'other-customer-file',values:bill}})).status,404);assert.equal(raw(f),before);
 assert.equal((await operationsGet(ctx(f,null,'https://solectrics.co.nz/api/job-tasks'))).status,403);
});
test('manual seasonal and additional bills retain originals/history and update derived energy without touching issued snapshots',async()=>{
 const f=fixture();const snapshot='{"issued":"synthetic immutable"}';f.sql.prepare('INSERT INTO customer_quote_versions(id,job_id,version_number,status,snapshot_json,source_hash) VALUES(?,?,?,?,?,?)').run('synthetic-issued',9101,1,'issued',snapshot,'hash');
 assert.equal((await save(f,{}, {bill:{slot:'summer',values:bill}})).status,200);let answers=JSON.parse(raw(f));assert.equal(answers.energy_data.history[0].previous.total_bill_nzd,100);assert.equal(answers.bills.summer.average_daily_kwh,20);assert.equal(deriveBaseline(answers).annual_consumption_kwh,7300);assert.equal(deriveBaseline(answers).annual_expenditure_nzd,2190);
 const oldCount=answers.hec_audit.history.length;assert.equal((await save(f,{}, {bill:{slot:'additional',values:bill}})).status,200);answers=JSON.parse(raw(f));const id=answers.additionalBills[0].id;assert.equal((await save(f,{}, {bill:{slot:'additional',id,values:{...bill,total_import_kwh:650,charged_import_kwh:550}}})).status,200);answers=JSON.parse(raw(f));assert.equal(answers.additionalBills.length,1);assert.equal(answers.hec_audit.history.length,oldCount+2);
 assert.equal(f.sql.prepare('SELECT snapshot_json FROM customer_quote_versions').get().snapshot_json,snapshot);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM job_files').get().n,0);
 const identity=resolveElectricityDetails({answers_json:raw(f),retailer:'Legacy conflicting retailer'});assert.equal(identity.retailer,'Example Energy');
 const e=await energyGet(ctx(f,null,'http://localhost/api/energy-review?job_id=9101'));assert.equal(e.status,200);const result=await e.json();assert.equal(result.review.current_plan.retailer,'Example Energy');assert.equal(result.review.model.model_ready,false);
});
test('existing saved energy models are marked stale after household changes; design data and prior review stay intact',async()=>{
 const f=fixture();await energyGet(ctx(f,null,'http://localhost/api/energy-review?job_id=9101'));f.sql.prepare('INSERT INTO system_designs(job_id,data_json) VALUES(?,?)').run(9101,'{"design_reviewed":true,"design_retailer":"Staff decision"}');
 f.sql.prepare('INSERT INTO energy_reviews(job_id,current_plan_json,baseline_json,proposed_system_json,scenario_json,model_json) VALUES(?,?,?,?,?,?)').run(9101,'{"retailer":"Prior"}','{}','{}','{}','{"model_ready":true,"energy_revision":"old"}');
 await save(f,{people:'5+',hotWater:'Heat-pump hot water'});const r=await (await energyGet(ctx(f,null,'http://localhost/api/energy-review?job_id=9101'))).json();assert.equal(r.energy_update_requires_review,true);assert.equal(r.review.model.model_ready,false);assert.equal(r.previous_energy_review.current_plan.retailer,'Prior');assert.match(f.sql.prepare('SELECT data_json FROM system_designs WHERE job_id=9101').get().data_json,/Staff decision/);
});
test('Operations refuses missing schema without writing and shares reviewed HEC identity',async()=>{
 const f=fixture();await save(f,{retailer:'Example Retailer',plan_name:'Example Plan',icp:'000000000AA000A'});const r=await operationsGet(ctx(f,null,'http://localhost/api/job-tasks?job_id=9101'));assert.equal(r.status,200);assert.equal((await r.json()).electricity_details.retailer,'Example Retailer');f.sql.exec('DROP TABLE job_tasks');assert.equal((await operationsGet(ctx(f,null,'http://localhost/api/job-tasks'))).status,503);
});

test('reviewed design cannot certify an obsolete HEC revision; an explicit current review is saved',async()=>{
 const f=fixture();await save(f,{people:'4'});const revision=JSON.parse(raw(f)).energy_data.revision;
 const payload={job_id:9101,system_design:{design_reviewed:true,hec_revision:'obsolete',design_retailer:'Synthetic decision'}};
 assert.equal((await designPost(ctx(f,payload))).status,409);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM system_designs').get().n,0);
 payload.system_design.hec_revision=revision;assert.equal((await designPost(ctx(f,payload))).status,200);assert.equal(JSON.parse(f.sql.prepare('SELECT data_json FROM system_designs WHERE job_id=9101').get().data_json).hec_revision,revision);
});
