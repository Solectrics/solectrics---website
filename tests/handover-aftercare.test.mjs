import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { aftercareDates, handoverInput, nzToday, saveHandover } from '../functions/api/handover-aftercare.js';
import { onRequestPost, onRequestGet } from '../functions/api/job-tasks.js';

const checklist = { documents:true, operation:true, monitoring:true, support:true };
const payload = { completed_date:'2026-01-31', checklist, notes:'Synthetic handover only', actor:'Jane' };
function fixture(includeAftercare = true) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../staging/pre-0015-baseline.sql',import.meta.url),'utf8'));
  for (const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>/^00(1[5-9]|2[0-2])_/.test(f)).sort()) {
    if (!includeAftercare && file.startsWith('0022_')) continue;
    sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  }
  sql.exec("INSERT INTO enquiries (id,enquiry_ref,customer_name,answers_json) VALUES (1,'SYNTHETIC-AFTERCARE','SYNTHETIC AFTERCARE','{}'); INSERT INTO jobs (id,enquiry_id,job_type) VALUES (17,1,'solar'),(18,1,'solar');");
  const db = {
    prepare(query) {
      const prepared = { bind(...args) { const stmt=sql.prepare(query);return {
        query,args,
        async run(){return stmt.run(...args.map(v=>v??null));},
        async first(){return stmt.get(...args.map(v=>v??null))||null;},
        async all(){return {results:stmt.all(...args.map(v=>v??null))};}
      }; } };
      return {...prepared,all:()=>prepared.bind().all(),first:()=>prepared.bind().first()};
    },
    async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}
  };
  return { db,sql,rows:()=>sql.prepare('SELECT * FROM job_tasks WHERE job_id=17 ORDER BY task_key').all() };
}
async function post(db,body){const response=await onRequestPost({env:{DB:db},request:new Request('https://staging.invalid/api/job-tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:17,...body})})});return {status:response.status,body:await response.json()};}

test('calendar-month and fortnight dates cover leap years, month ends and year rollover',()=>{
  assert.deepEqual(aftercareDates('2026-01-31'),['2026-02-14','2026-02-28']);
  assert.deepEqual(aftercareDates('2024-01-31'),['2024-02-14','2024-02-29']);
  assert.deepEqual(aftercareDates('2026-10-01'),['2026-10-15','2026-11-01']);
  assert.deepEqual(aftercareDates('2026-12-31'),['2027-01-14','2027-01-31']);
  assert.deepEqual(aftercareDates('2026-03-31'),['2026-04-14','2026-04-30']);
  assert.throws(()=>aftercareDates('2026-02-30'));
  assert.equal(nzToday(new Date('2026-10-12T18:00:00Z')),'2026-10-13');
});
test('handover requires genuine date and complete checklist',()=>{
  assert.throws(()=>handoverInput({...payload,completed_date:'2099-01-01'}));
  assert.throws(()=>handoverInput({...payload,completed_date:'2026-02-30'}));
  assert.throws(()=>handoverInput({...payload,checklist:{documents:true}}));
});
test('real SQLite migrations preserve customer/job and repeated handover saves create exactly two tasks',async()=>{
  const f=fixture();
  for(let n=0;n<3;n++)await saveHandover(f.db,17,payload);
  assert.equal(f.rows().length,2);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM enquiries').get().n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,2);
  assert.equal(f.sql.prepare('SELECT handover_notes FROM jobs WHERE id=17').get().handover_notes,payload.notes);
  assert.equal(f.sql.prepare('SELECT handover_completed_at FROM jobs WHERE id=18').get().handover_completed_at,null);
  assert.deepEqual(f.rows().map(t=>t.due_date),['2026-02-28','2026-02-14']);
});
test('contact notes/date/issues persist; completion requires date; reopening does not duplicate tasks',async()=>{
  const f=fixture();await saveHandover(f.db,17,payload);const task=f.rows()[0];
  assert.equal((await post(f.db,{action:'update_task',task_id:task.id,status:'completed'})).status,400);
  assert.equal((await post(f.db,{action:'update_task',task_id:task.id,status:'completed',contact_date:'2026-02-28',contact_notes:'Called customer',outstanding_issues:'Monitoring query',actor:'Tom'})).status,200);
  const completed=f.rows()[0];assert.equal(completed.contact_notes,'Called customer');assert.equal(completed.outstanding_issues,'Monitoring query');assert.equal(completed.completed_by,'Tom');
  await saveHandover(f.db,17,payload);assert.deepEqual(f.rows()[0],completed);
  await post(f.db,{action:'update_task',task_id:task.id,status:'open'});
  await saveHandover(f.db,17,payload);assert.equal(f.rows().length,2);assert.equal(f.rows()[0].status,'open');assert.equal(f.rows()[0].contact_date,'2026-02-28');
});
test('date correction requires confirmation and changes only open follow-ups',async()=>{
  const f=fixture();await saveHandover(f.db,17,payload);const task=f.rows()[0];
  await post(f.db,{action:'update_task',task_id:task.id,status:'completed',contact_date:'2026-02-28'});
  const completed=f.rows()[0];
  await assert.rejects(saveHandover(f.db,17,{...payload,completed_date:'2026-02-01'}));
  await saveHandover(f.db,17,{...payload,completed_date:'2026-02-01',confirm_date_change:true});
  assert.deepEqual(f.rows()[0],completed);assert.equal(f.rows()[1].due_date,'2026-02-15');
});
test('follow-up cannot be cancelled, lose due date, use invalid contact date or edit another job task',async()=>{
  const f=fixture();await saveHandover(f.db,17,payload);const task=f.rows()[0];
  for(const edit of [{status:'cancelled'},{due_date:''},{contact_date:'2026-02-30'},{contact_date:'2099-01-01'}])assert.equal((await post(f.db,{action:'update_task',task_id:task.id,...edit})).status,400);
  assert.equal((await post(f.db,{job_id:18,action:'update_task',task_id:task.id,contact_notes:'Wrong job'})).status,404);
  assert.equal(f.rows()[0].contact_notes,null);
});
test('checklist draft and handover API reuse job; generic updates cannot bypass checklist',async()=>{
  const f=fixture();
  assert.equal((await post(f.db,{action:'save_handover_checklist',checklist:{documents:true},notes:'Draft'})).status,200);
  assert.equal(f.rows().length,0);
  assert.equal((await post(f.db,{action:'update_job_stage',handover_completed_at:'2026-01-31'})).status,400);
  f.sql.exec("INSERT INTO job_tasks(job_id,task_key,title) VALUES(17,'customer-handover','Handover')");
  const task=f.rows()[0];assert.equal((await post(f.db,{action:'update_task',task_id:task.id,status:'completed'})).status,409);
  assert.equal((await post(f.db,{action:'handover_complete',...payload})).status,200);
  assert.equal((await post(f.db,{action:'save_handover_checklist',checklist:{}})).status,400);
});
test('handover rejects non-solar or nonexistent jobs without writes',async()=>{
  const f=fixture();f.sql.exec("UPDATE jobs SET job_type='general_electrical' WHERE id=18");
  assert.equal((await post(f.db,{job_id:18,action:'handover_complete',...payload})).status,400);
  assert.equal((await post(f.db,{job_id:999,action:'handover_complete',...payload})).status,404);
  assert.equal(f.rows().length,0);
});
test('same-date save preserves manually adjusted open follow-up dates',async()=>{
  const f=fixture();await saveHandover(f.db,17,payload);const task=f.rows()[0];
  await post(f.db,{action:'update_task',task_id:task.id,due_date:'2026-03-03'});
  await saveHandover(f.db,17,payload);assert.equal(f.rows()[0].due_date,'2026-03-03');
});
test('same-date save corrects untouched legacy 30-day tasks but not manually moved ones',async()=>{
  const f=fixture();await saveHandover(f.db,17,payload);
  f.sql.exec("UPDATE job_tasks SET due_date='2026-03-02', anchor_offset_days=30 WHERE task_key='aftercare-1-month'");
  await saveHandover(f.db,17,payload);assert.equal(f.rows()[0].due_date,'2026-02-28');
  f.sql.exec("UPDATE job_tasks SET due_date='2026-03-05', anchor_offset_days=30 WHERE task_key='aftercare-1-month'");
  await saveHandover(f.db,17,payload);assert.equal(f.rows()[0].due_date,'2026-03-05');
});
test('API reload returns same task IDs, contact fields and checklist including open follow-ups on closed jobs',async()=>{
  const f=fixture();await saveHandover(f.db,17,payload);const task=f.rows()[0];
  await post(f.db,{action:'update_task',task_id:task.id,contact_date:'2026-02-28',contact_notes:'Persisted',outstanding_issues:'Still needs action'});
  f.sql.exec("UPDATE jobs SET job_closed_at='2026-02-01' WHERE id=17");
  for(const query of ['?include_completed=1','?job_id=17&include_completed=1']){
    const response=await onRequestGet({env:{DB:f.db},request:new Request('https://staging.invalid/api/job-tasks'+query)});
    assert.equal(response.status,200);const data=await response.json();
    assert.equal(data.tasks.find(t=>t.id===task.id).contact_notes,'Persisted');
    assert.equal(data.tasks.find(t=>t.id===task.id).status,'open');
    assert.equal(JSON.parse(data.jobs.find(j=>j.job_id===17).handover_checklist_json).support,true);
  }
});
test('Operations shows overdue aftercare on closed jobs and calendar uses the same records',()=>{
  const html=readFileSync(new URL('../mini-fergus-operations.html',import.meta.url),'utf8');
  const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1].replace(/loadData\(\);\s*$/,'');
  const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,innerHTML:''});return elements.get(id);};
  const sandbox={document:{getElementById:get},URLSearchParams,Date,console,window:{location:{}},fetch:()=>{throw Error('No network allowed');}};
  vm.createContext(sandbox);vm.runInContext(script,sandbox);
  vm.runInContext(`state.jobs=[{job_id:17,job_type:'solar',job_closed_at:'2026-01-01'}];state.tasks=[{id:1,job_id:17,task_key:'aftercare-1-month',title:'Check-in',customer_name:'Synthetic',status:'open',due_date:'2026-01-01',category:'aftercare',event_kind:'milestone'}];state.month=new Date(2026,0,1);renderAll();`,sandbox);
  assert.match(get('attentionTasks').innerHTML,/Overdue/);
  assert.match(get('calendar').innerHTML,/Check-in/);
  assert.match(get('attentionTasks').innerHTML,/#handoverAftercare/);
  vm.runInContext(`state.tasks[0].status='completed';renderAll();`,sandbox);
  assert.doesNotMatch(get('attentionTasks').innerHTML,/Check-in/);
});
test('job page and Operations inline scripts parse; aftercare links lead to dedicated panel',()=>{
  for(const file of ['mini-fergus-job.html','mini-fergus-operations.html']){
    const html=readFileSync(new URL('../'+file,import.meta.url),'utf8');
    for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
    assert.match(html,/handoverAftercare/);
  }
});
test('without 0022 the existing Operations read and ordinary task updates still work; new handover fails closed',async()=>{
  const f=fixture(false);
  f.sql.exec("INSERT INTO job_tasks(job_id,task_key,title) VALUES(17,'ordinary','Synthetic ordinary task')");
  const response=await onRequestGet({env:{DB:f.db},request:new Request('https://staging.invalid/api/job-tasks?job_id=17')});
  assert.equal(response.status,200);assert.equal((await response.json()).handover_enabled,false);
  assert.equal((await post(f.db,{action:'update_task',task_id:f.rows()[0].id,status:'completed'})).status,200);
  assert.equal((await post(f.db,{action:'handover_complete',...payload})).status,503);
  assert.equal(f.sql.prepare('SELECT handover_completed_at FROM jobs WHERE id=17').get().handover_completed_at,null);
});
test('handover batch failure rolls back date, checklist and generated tasks together',async()=>{
  const f=fixture();f.sql.exec("CREATE TRIGGER fail_aftercare BEFORE INSERT ON job_tasks WHEN NEW.task_key='aftercare-1-month' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  await assert.rejects(saveHandover(f.db,17,payload),/synthetic failure/);
  assert.equal(f.rows().length,0);
  assert.equal(f.sql.prepare('SELECT handover_completed_at FROM jobs WHERE id=17').get().handover_completed_at,null);
});
