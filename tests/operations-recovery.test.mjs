import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticDb,seedJobs} from './helpers/synthetic-db.mjs';
import {onRequestGet as get,onRequestPost as post} from '../functions/api/job-tasks.js';
import {onRequestPost as quotePost} from '../functions/api/customer-quotes.js';
function fixture(){const f=syntheticDb();seedJobs(f.sql);return f;}
const ctx=(f,body,route='job-tasks')=>({env:{DB:f.db,JOBHUB_USABILITY_LOCAL_ONLY:'true'},request:new Request('http://localhost/api/'+route+'?job_id=9101&include_completed=1',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:9101,...body})}:{})});
const update=(f,body)=>post(ctx(f,body));
test('Operations saves and reloads every installation workflow field used by its UI',async()=>{
 const f=fixture(),values={finance_provider:'Synthetic Lender',equipment_invoice_reference:'SYNTHETIC-INVOICE',scaffold_quote_cost:123,scaffold_arranged_by:'Synthetic Staff',scaffold_erection_date:'2026-11-01',scaffold_removal_date:'2026-11-05',equipment_expected_delivery_date:'2026-10-30',site_access_notes:'Synthetic access',retailer_requirements:'Synthetic controlled load'};
 const r=await update(f,{action:'update_job_stage',...values});assert.equal(r.status,200);const data=await(await get(ctx(f))).json();for(const[key,value]of Object.entries(values))assert.equal(data.jobs[0][key],value,key);
});
test('calendar rescheduling asks before moving open anchored tasks and never duplicates generated tasks',async()=>{
 const f=fixture();assert.equal((await update(f,{action:'set_install_date',install_date:'2026-11-20'})).status,200);const before=f.sql.prepare("SELECT * FROM job_tasks WHERE job_id=9101 ORDER BY id").all();assert.ok(before.length>0);
 const proposal=await update(f,{action:'set_install_date',install_date:'2026-11-27'});assert.equal(proposal.status,409);const data=await proposal.json();assert.equal(data.needs_confirmation,true);
 assert.equal((await update(f,{action:'set_install_date',install_date:'2026-11-27',confirm_reschedule:true,move_task_ids:data.tasks.map(t=>t.id)})).status,200);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM job_tasks').get().n,before.length);
 assert.equal((await update(f,{action:'set_install_date',install_date:'2026-02-30'})).status,400);
});
test('readiness blocks starting installation and task ownership/evidence checks preserve other jobs',async()=>{
 const f=fixture();assert.equal((await update(f,{action:'update_job_stage',install_status:'in_progress'})).status,409);
 assert.equal((await update(f,{action:'create_task',title:'Synthetic task',assigned_to:'Tom',due_date:'2026-10-25',requires_evidence:true})).status,200);const t=f.sql.prepare('SELECT * FROM job_tasks').get();assert.equal(t.assigned_to,'Tom');assert.equal((await update(f,{action:'update_task',task_id:t.id,status:'completed'})).status,400);
 assert.equal((await update(f,{action:'update_task',job_id:9102,task_id:t.id,status:'completed',evidence_note:'Synthetic evidence'})).status,404);
 assert.equal((await update(f,{action:'update_task',task_id:t.id,status:'completed',evidence_note:'Synthetic evidence',actor:'Tom'})).status,200);
});
test('accepted quotes seed shared workflow once and retain their immutable issued snapshot',async()=>{
 const f=fixture(),snapshot='{"synthetic":"immutable issued option"}';f.sql.prepare('INSERT INTO customer_quote_versions(id,job_id,version_number,status,snapshot_json,source_hash) VALUES(?,?,?,?,?,?)').run('synthetic-accept',9101,1,'issued',snapshot,'synthetic');
 for(let n=0;n<2;n++){const r=await quotePost(ctx(f,{action:'set_status',quote_id:'synthetic-accept',status:'accepted'},'customer-quotes'));assert.equal(r.status,200);}
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM job_tasks').get().n,6);assert.equal(f.sql.prepare('SELECT snapshot_json FROM customer_quote_versions').get().snapshot_json,snapshot);
});
