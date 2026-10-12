import test from 'node:test';
import assert from 'node:assert/strict';
import {postHecEnergyAction,validateReviewedBill,applyReviewedBill,energyRevision,sharedIdentity} from '../functions/api/_post-hec-energy.js';
import {deriveCurrentPlan,deriveBaseline,onRequestGet as energyGet} from '../functions/api/energy-review.js';
import {buildEnergyComparison} from '../functions/api/customer-quotes.js';
import {onRequestPost as jobPost} from '../functions/api/job.js';

const host='https://fletcher-package-mobile-fix.solectrics-jobhub-staging.pages.dev';
const fixture={retailer:'Contact',plan_name:null,icp:'000000000AA000A',billing_period_start:'2026-08-20',billing_period_end:'2026-09-18',billing_days:30,
 total_import_kwh:877,charged_import_kwh:781,free_import_kwh:96,total_export_kwh:null,total_bill_nzd:397.36,electricity_charges_nzd:337.36,
 non_electricity_charges_nzd:60,gst_nzd:51.83,electricity_gst_nzd:44,electricity_cost_separation_status:'separated',
 import_rate_cents:31.8,import_rate_gst_basis:'exclusive',daily_fixed_charge_cents:150,daily_fixed_charge_gst_basis:'exclusive',
 tariff_description:'Low User; free Saturday/Sunday 9 am–5 pm',free_import_schedule:'Saturday/Sunday 9 am–5 pm',export_rate_cents:null};
function environment(answers={name:'Synthetic',icp:'000000000BB000B',bills:{summer:{retailer:'Example',total_bill_nzd:240}}}){
 const saved={json:JSON.stringify(answers),writes:[],reads:[],objects:[],collide:false};
 const file={id:'bill-7',job_id:7,enquiry_id:3,storage_key:'jobs/7/bill-7.pdf',original_name:'synthetic.pdf',document_role:'power_bill',content_type:'application/pdf',size_bytes:10};
 const db={prepare(sql){return {params:[],bind(...p){this.params=p;return this;},async first(){saved.reads.push(sql);if(sql.includes('FROM job_files'))return this.params[0]==='bill-7' && this.params[1]===7?{...file,answers_json:saved.json}:null;if(sql.includes('JOIN enquiries'))return {enquiry_id:3,answers_json:saved.json,customer_name:'Synthetic'};return null;},async all(){return {results:[]};},async run(){if(sql.startsWith('UPDATE enquiries')){assert.equal(this.params[1],3);assert.equal(this.params[2],saved.json);if(saved.collide)return {meta:{changes:0}};saved.json=this.params[0];saved.writes.push(sql);return {meta:{changes:1}};}throw Error('Unexpected write '+sql);}};},async batch(statements){return statements.map(()=>({}));}};
 const env={DB:db,JOBHUB_STAGING_ONLY:'true',ALLOW_PAGES_DEV_HOST:'true',OPENAI_API_KEY:'test-only',JOB_FILES:{get:async key=>{saved.objects.push(key);return {arrayBuffer:async()=>new TextEncoder().encode('Synthetic bill').buffer};}}};
 return {saved,env};
}
async function action(e,body,url=host){return postHecEnergyAction({env:e.env,request:new Request(url+'/api/job-files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:7,file_id:'bill-7',...body})})});}
async function extract(e){const old=globalThis.fetch;globalThis.fetch=async(url)=>{assert.equal(url,'https://api.openai.com/v1/responses');return Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(fixture)}]}]});};try{return await (await action(e,{action:'read_energy_bill'})).json();}finally{globalThis.fetch=old;}}
test('extraction retains original file, stores draft only, and never creates customer/enquiry/job/file records',async()=>{
 const e=environment(),before=JSON.parse(e.saved.json);const data=await extract(e);assert.equal(data.ok,true);
 const stored=JSON.parse(e.saved.json);assert.deepEqual(stored.bills,before.bills);assert.equal(stored.energy_data.drafts['bill-7'].extracted.total_bill_nzd,397.36);
 assert.deepEqual(e.saved.objects,['jobs/7/bill-7.pdf']);assert.ok(e.saved.writes.every(sql=>sql.startsWith('UPDATE enquiries')));
});
test('approval preserves raw/previous values and updates the same answers consumed by energy calculations',async()=>{
 const e=environment();const draft=await extract(e);
 const r=await action(e,{action:'save_energy_bill',revision:draft.revision,approved:true,slot:'summer',bill:fixture});assert.equal(r.status,200);
 const answers=JSON.parse(e.saved.json),history=answers.energy_data.history[0];assert.equal(history.previous.total_bill_nzd,240);assert.equal(history.extracted.electricity_charges_nzd,337.36);assert.equal(history.source,'post_hec_job_bill');assert.ok(history.reviewed_at);
 assert.equal(sharedIdentity(answers).icp,fixture.icp);assert.equal(answers.bills.summer.total_export_kwh,null);
 const plan=deriveCurrentPlan(answers),baseline=deriveBaseline(answers);assert.equal(plan.standard_import_rate_cents,36.57);assert.equal(plan.daily_charge_cents,172.5);
 assert.equal(baseline.annual_expenditure_nzd,4105);assert.equal(baseline.annual_fixed_charges_nzd,629.63);assert.equal(answers.bills.summer.charged_import_kwh+answers.bills.summer.free_import_kwh,877);
 assert.equal(buildEnergyComparison({...answers,quote_graph:{current:Array(12).fill(900),solar:Array(12).fill(5),battery:Array(12).fill(3)}},{solar_kw:5}),null);
});
test('unapproved, stale, repeated and concurrent approval cannot overwrite saved values',async()=>{
 const e=environment(),draft=await extract(e);const body={action:'save_energy_bill',revision:draft.revision,approved:true,slot:'winter',bill:fixture};
 assert.equal((await action(e,{...body,approved:false})).status,400);
 assert.equal((await action(e,{...body,revision:'stale'})).status,409);
 e.saved.collide=true;assert.equal((await action(e,body)).status,409);e.saved.collide=false;
 assert.equal((await action(e,body)).status,200);assert.equal((await action(e,body)).status,409);
 assert.equal(JSON.parse(e.saved.json).energy_data.history.length,1);
});
test('unrelated file/job and production or missing flags stop before object access or writes',async()=>{
 for(const change of [{body:{file_id:'other'}},{body:{job_id:8}},{url:'https://www.solectrics.co.nz'},{flag:false}]){
  const e=environment();if(change.flag===false)e.env.ALLOW_PAGES_DEV_HOST='false';const r=await action(e,{action:'read_energy_bill',...change.body},change.url || host);assert.ok([403,404].includes(r.status));assert.equal(e.saved.writes.length,0);assert.equal(e.saved.objects.length,0);
 }
});
test('unknown electricity separation cannot use whole invoice as baseline; reviewed zero stays zero',()=>{
 const bill=validateReviewedBill({total_bill_nzd:400,billing_days:30,total_import_kwh:600,total_export_kwh:0});
 assert.equal(bill.electricity_cost_separation_status,'needs_review');assert.equal(bill.total_export_kwh,0);
 assert.equal(deriveBaseline({bills:{summer:bill}}).annual_expenditure_nzd,null);
 const legacy=deriveBaseline({bills:{summer:{total_bill_nzd:240,billing_days:30,average_daily_kwh:20}}});assert.equal(legacy.annual_expenditure_nzd,2920);
});
test('invalid splits, dates, negative charges and non-reconciled services are rejected',()=>{
 for(const update of [{free_import_kwh:90},{electricity_charges_nzd:335},{billing_days:0},{billing_period_start:'2026-02-30'},{total_bill_nzd:-1}])assert.throws(()=>validateReviewedBill({...fixture,...update}));
});
test('staff ICP correction saves once with history and never rewrites Site Visit / Design',async()=>{
 const e=environment(),revision=await energyRevision(e.saved.json);
 const r=await jobPost({env:e.env,request:new Request(host+'/api/job',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:7,action:'save_shared_icp',icp:fixture.icp,revision})})});
 assert.equal(r.status,200);const a=JSON.parse(e.saved.json);assert.equal(a.icp,fixture.icp);assert.equal(a.energy_data.identity_history.length,1);assert.ok(e.saved.writes.every(sql=>sql.startsWith('UPDATE enquiries')));
});
test('approved bill updates pause obsolete energy models without overwriting their saved review',async()=>{
 const reviewed=validateReviewedBill(fixture),answers=applyReviewedBill({bills:{}},{file:{id:'bill-7',original_name:'synthetic.pdf'},draft:{extracted:fixture,extracted_at:'2026-10-12'},bill:reviewed,slot:'winter',now:'2026-10-12'});
 const stored={job_id:7,status:'completed',current_plan_json:JSON.stringify({retailer:'Previous'}),baseline_json:JSON.stringify({annual_expenditure_nzd:5000}),model_json:JSON.stringify({model_ready:true}),scenario_json:'{}',proposed_system_json:'{}',assumptions_json:'[]'};
 const e=environment(answers),oldPrepare=e.env.DB.prepare;
 e.env.DB.prepare=sql=>{if(sql.includes('SELECT * FROM energy_reviews'))return {bind(){return this;},first:async()=>stored};return oldPrepare(sql);};
 const response=await energyGet({env:e.env,request:new Request(host+'/api/energy-review?job_id=7')});const data=await response.json();
 assert.equal(data.energy_update_requires_review,true);assert.equal(data.review.model.model_ready,false);assert.equal(data.review.current_plan.retailer,'Contact');assert.equal(data.review.baseline.annual_expenditure_nzd,4105);
 assert.equal(data.previous_energy_review.baseline.annual_expenditure_nzd,5000);assert.deepEqual(data.comparisons,[]);assert.equal(stored.status,'completed');assert.equal(e.saved.writes.length,0);
});
