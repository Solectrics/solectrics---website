import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {syntheticAccess} from './helpers/synthetic-access.mjs';
import {syntheticDb,seedJobs} from './helpers/synthetic-db.mjs';
import {ACCEPTANCE_HOST,stagingStaff} from '../functions/api/_usability-staging.js';
import {clearAccessKeyCacheForTests} from '../functions/api/_access-security.js';
import {onRequest as rootMiddleware} from '../functions/_middleware.js';
import {onRequest as apiMiddleware} from '../functions/api/_middleware.js';
const auth=await syntheticAccess();
async function fixture(run){
 const f=syntheticDb();seedJobs(f.sql);let reads=0,writes=0,objects=0;
 const prepare=f.db.prepare.bind(f.db);f.db.prepare=q=>{reads++;if(/^(UPDATE|INSERT|DELETE|CREATE|ALTER)/i.test(q.trim()))writes++;return prepare(q);};
 f.env={...auth.env,DB:f.db,JOB_FILES:{get:async()=>{objects++;return null;},head:async()=>{objects++;return null;},put:async()=>{objects++;}}};
 f.counts=()=>({reads,writes,objects});
 const old=globalThis.fetch;globalThis.fetch=auth.jwksFetch;clearAccessKeyCacheForTests();
 try{await run(f);}finally{globalThis.fetch=old;clearAccessKeyCacheForTests();f.sql.close();}
}
async function request(f,route,{method='GET',body,token,host=ACCEPTANCE_HOST,origin='https://'+host,type='application/json',flags={},headers={}}={}){
 const h=new Headers(headers);if(token!==null)h.set('Cf-Access-Jwt-Assertion',token||await auth.token());
 let payload;if(body!==undefined){h.set('Content-Type',type);payload=type==='application/json'?JSON.stringify(body):body;}
 if(!['GET','HEAD'].includes(method)&&origin!==null)h.set('Origin',origin);
 const c={env:{...f.env,...flags},data:{},request:new Request('https://'+host+'/api/'+route,{method,headers:h,...(payload!==undefined?{body:payload}:{})})};
 const handler=async()=>{const name=route.split('?')[0];const mod=await import('../functions/api/'+name+'.js');const key='onRequest'+method[0]+method.slice(1).toLowerCase();return mod[key]?mod[key](c):new Response('Method unavailable',{status:405});};
 const api=()=>apiMiddleware({...c,next:handler});return rootMiddleware({...c,next:api});
}
const load=async f=>(await request(f,'job-hec?job_id=9101')).json();
async function save(f,patch,extra={}){const current=await load(f);return request(f,'job-hec',{method:'POST',body:{job_id:9101,patch,revision:current.revision,approved:true,reason:'Synthetic authenticated correction',actor:'FORGED ACTOR',...extra}});}
function attach(f,id,jobId=9101,role='power_bill') {f.sql.prepare('INSERT INTO job_files(id,job_id,storage_key,original_name,content_type,size_bytes,category,document_role) VALUES(?,?,?,?,?,?,?,?)').run(id,jobId,'synthetic/'+id+'.pdf',id+'.pdf','application/pdf',20,'other',role);}

test('security verifier is the exact pinned reference, not the missing local candidate',()=>{
 const b=readFileSync(new URL('../functions/api/_access-security.js',import.meta.url));assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex'),'fc70dea400697ca358b80cc01e7ca94595453b9d');
});
test('missing, forged, expired, wrong audience/issuer, missing subject and non-staff assertions stop before DB/R2',async()=>fixture(async f=>{
 const tokens=[null,'forged.token.value',await auth.token({exp:1}),await auth.token({aud:['wrong']}),await auth.token({iss:'https://other.example.invalid'}),await auth.token({sub:''}),await auth.token({email:'outsider@example.invalid'}),await auth.token({nbf:Math.floor(Date.now()/1000)+600}),await auth.token({}, {alg:'HS256'})];
 for(const token of tokens){const before=f.counts();const r=await request(f,'job-hec?job_id=9101',{token});assert.ok([401,403].includes(r.status));assert.deepEqual(f.counts(),before);}
}));
test('all private usability surfaces deny unverified staff before storage',async()=>fixture(async f=>{
 for(const route of ['job-hec?job_id=9101','job-tasks?job_id=9101','job-file?id=synthetic','job-files?job_id=9101','job-document-inventory?job_id=9101','customer-quotes?quote_id=synthetic','customer-invoices?invoice_id=synthetic','system-design?job_id=9101','energy-review?job_id=9101']){const before=f.counts();assert.equal((await request(f,route,{token:null})).status,401);assert.deepEqual(f.counts(),before);}
}));
test('wrong host, missing flags/wildcard audience and absent explicit binding cannot open staging',async()=>fixture(async f=>{
 for(const options of [{host:'solectrics.co.nz'},{host:'usability-acceptance.solectrics-jobhub-staging.pages.dev'},{host:'unapproved.solectrics-jobhub-staging.pages.dev'},{flags:{JOBHUB_USABILITY_STAGING:'false'}},{flags:{JOBHUB_STAGING_ONLY:'false'}},{flags:{JOBHUB_ACCESS_AUDIENCES:JSON.stringify({'*.pages.dev':'synthetic'})}},{flags:{JOB_FILES:undefined,UPLOADS:f.env.JOB_FILES}}]){const before=f.counts();assert.ok([401,403,503].includes((await request(f,'job-hec?job_id=9101',options)).status));assert.deepEqual(f.counts(),before);}
 assert.equal(stagingStaff({env:f.env,data:{usabilityStaff:{subject:'forged'}},request:new Request('https://'+ACCEPTANCE_HOST)}),null);
}));
test('wrong-origin and wrong-content-type mutations stop before DB/R2',async()=>fixture(async f=>{
 for(const options of [{origin:'https://attacker.example.invalid'},{origin:null},{type:'text/plain'}]){const before=f.counts();assert.ok([403,415].includes((await request(f,'job-tasks',{method:'POST',body:{action:'update_settings'},...options})).status));assert.deepEqual(f.counts(),before);}
}));
test('Jane and Tom assertions enable HEC and record verified identity rather than a forged actor',async()=>fixture(async f=>{
 assert.equal((await save(f,{people:'4'})).status,200);let a=JSON.parse(f.sql.prepare('SELECT answers_json FROM enquiries WHERE id=9101').get().answers_json);assert.equal(a.hec_audit.history[0].actor,'synthetic-jane-subject');assert.equal(a.hec_audit.history[0].identity.email,'jane@example.invalid');
 const token=await auth.token({email:'tom@example.invalid',sub:'synthetic-tom-subject'}),current=await load(f);
 assert.equal((await request(f,'job-hec',{method:'POST',token,body:{job_id:9101,patch:{people:'5+'},revision:current.revision,reason:'Synthetic Tom',approved:true,actor:'FORGED'}})).status,200);
 a=JSON.parse(f.sql.prepare('SELECT answers_json FROM enquiries WHERE id=9101').get().answers_json);assert.equal(a.hec_audit.history[1].actor,'synthetic-tom-subject');assert.equal(a.hec_audit.original.people,'2');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM jobs').get().n,2);
 const r=await request(f,'job-hec?job_id=9101');assert.equal(r.headers.get('Cache-Control'),'private, no-store');
}));
test('manual bill and shared ICP histories use verified actor; file/job mismatch does not write',async()=>fixture(async f=>{
 attach(f,'synthetic-bill');attach(f,'other-bill',9102);const values={retailer:'Synthetic Energy',icp:'000000000AA000A',billing_days:30,total_import_kwh:600,total_bill_nzd:180,electricity_charges_nzd:180,electricity_cost_separation_status:'electricity_only'};
 assert.equal((await save(f,{}, {bill:{slot:'winter',file_id:'synthetic-bill',values}})).status,200);let row=f.sql.prepare('SELECT answers_json FROM enquiries WHERE id=9101').get(),a=JSON.parse(row.answers_json);assert.equal(a.energy_data.history[0].actor,'synthetic-jane-subject');
 const writes=f.counts().writes;assert.equal((await save(f,{}, {bill:{slot:'winter',file_id:'other-bill',values}})).status,404);assert.equal(f.counts().writes,writes);
 const job=await(await request(f,'job?id=9101')).json();assert.equal((await request(f,'job',{method:'POST',body:{action:'save_shared_icp',job_id:9101,icp:'000000000BB000B',revision:job.answers_revision,actor:'FORGED'}})).status,200);
 a=JSON.parse(f.sql.prepare('SELECT answers_json FROM enquiries WHERE id=9101').get().answers_json);assert.equal(a.energy_data.identity_history.at(-1).actor,'synthetic-jane-subject');
}));
test('task completion/handover use authenticated subject while assignment remains separate',async()=>fixture(async f=>{
 assert.equal((await request(f,'job-tasks',{method:'POST',body:{job_id:9101,action:'create_task',title:'Synthetic task',assigned_to:'Tom'}})).status,200);const task=f.sql.prepare('SELECT id FROM job_tasks').get();
 assert.equal((await request(f,'job-tasks',{method:'POST',body:{job_id:9101,action:'update_task',task_id:task.id,status:'completed',actor:'FORGED'}})).status,200);assert.equal(f.sql.prepare('SELECT completed_by FROM job_tasks').get().completed_by,'synthetic-jane-subject');
 const body={job_id:9101,action:'handover_complete',completed_date:'2026-01-31',checklist:{documents:true,operation:true,monitoring:true,support:true},actor:'FORGED'};
 for(let n=0;n<2;n++)assert.equal((await request(f,'job-tasks',{method:'POST',body})).status,200);
 const rows=f.sql.prepare("SELECT * FROM job_tasks WHERE task_key LIKE 'aftercare-%'").all();assert.equal(rows.length,2);assert.deepEqual(rows.map(t=>t.due_date).sort(),['2026-02-14','2026-02-28']);
 const token=await auth.token({email:'tom@example.invalid',sub:'synthetic-tom-subject'});assert.equal((await request(f,'job-tasks',{method:'POST',token,body:{job_id:9101,action:'update_task',task_id:rows[0].id,status:'completed',contact_date:'2026-02-28',actor:'FORGED'}})).status,200);assert.equal(f.sql.prepare('SELECT completed_by FROM job_tasks WHERE id=?').get(rows[0].id).completed_by,'synthetic-tom-subject');
}));
test('nonexistent jobs and orphan/mismatched attachments fail before storage or child writes',async()=>fixture(async f=>{
 attach(f,'orphan-bill',9999);attach(f,'other-bill',9102);
 for(const route of ['job-file?id=orphan-bill','job-file?id=other-bill&job_id=9101','job-document-inventory?job_id=9999','job-files?job_id=9999','job-hec?job_id=9999']){const before=f.counts();assert.equal((await request(f,route)).status,404);assert.equal(f.counts().objects,before.objects);assert.equal(f.counts().writes,before.writes);}
 const before=f.counts();assert.equal((await request(f,'job-files',{method:'PATCH',body:{job_id:9101,id:'other-bill',category:'roof'}})).status,404);assert.equal(f.counts().writes,before.writes);
 const form=new FormData();form.set('job_id','9999');form.set('file',new File(['synthetic'],'synthetic.pdf',{type:'application/pdf'}));
 const c={env:f.env,data:{},request:new Request('https://'+ACCEPTANCE_HOST+'/api/job-files',{method:'POST',headers:{Origin:'https://'+ACCEPTANCE_HOST,'Cf-Access-Jwt-Assertion':await auth.token()},body:form}),next:()=>{throw Error('Upload handler must not run');}};
 assert.equal((await apiMiddleware(c)).status,404);assert.equal(f.counts().objects,before.objects);
}));
test('quote/invoice lookup or mutation cannot mix records between jobs',async()=>fixture(async f=>{
 f.sql.prepare('INSERT INTO customer_quote_versions(id,job_id,version_number,status,snapshot_json,source_hash) VALUES(?,?,?,?,?,?)').run('other-quote',9102,1,'issued','{"synthetic":"immutable"}','hash');f.sql.prepare('INSERT INTO customer_invoice_versions(id,job_id,version_number,status,snapshot_json,source_hash) VALUES(?,?,?,?,?,?)').run('other-invoice',9102,1,'issued','{"synthetic":"immutable"}','hash');
 for(const route of ['customer-quotes?quote_id=other-quote&job_id=9101','customer-invoices?invoice_id=other-invoice&job_id=9101'])assert.equal((await request(f,route)).status,404);
 assert.equal((await request(f,'customer-quotes',{method:'POST',body:{job_id:9101,quote_id:'other-quote',action:'set_status',status:'accepted'}})).status,404);assert.equal(f.sql.prepare('SELECT status FROM customer_quote_versions').get().status,'issued');
}));
test('all outbound processing is disabled even if synthetic provider keys were supplied',async()=>fixture(async f=>{
 for(const route of ['read-bill','fletcher-email','supplier-invoice-read','fletcher-quote-import','enquiry']){const before=f.counts();assert.equal((await request(f,route,{method:'POST',body:{job_id:9101},flags:{OPENAI_API_KEY:'synthetic-unused',RESEND_API_KEY:'synthetic-unused'}})).status,403);assert.deepEqual(f.counts(),before);}
}));

test('malformed audience configuration and JSON lookalike content types fail closed before storage',async()=>fixture(async f=>{
 for(const value of ['null','[]','{"'+ACCEPTANCE_HOST+'":42}']){const before=f.counts();assert.equal((await request(f,'job-hec?job_id=9101',{flags:{JOBHUB_ACCESS_AUDIENCES:value}})).status,403);assert.deepEqual(f.counts(),before);}
 const before=f.counts();assert.equal((await request(f,'job-hec',{method:'POST',type:'application/jsonp',body:'{}'})).status,415);assert.deepEqual(f.counts(),before);
}));

test('authenticated stale HEC saves preserve the winning response and history',async()=>fixture(async f=>{
 const first=await load(f);assert.equal((await save(f,{people:'4'})).status,200);
 const before=f.counts().writes;assert.equal((await request(f,'job-hec',{method:'POST',body:{job_id:9101,patch:{people:'5+'},revision:first.revision,reason:'Synthetic stale save',approved:true}})).status,409);assert.equal(f.counts().writes,before);
 const a=JSON.parse(f.sql.prepare('SELECT answers_json FROM enquiries WHERE id=9101').get().answers_json);assert.equal(a.people,'4');assert.equal(a.hec_audit.history.length,1);
}));

test('authenticated attachment download uses the stored object key and private response headers',async()=>fixture(async f=>{
 attach(f,'synthetic-download');let key;f.env.JOB_FILES.get=async value=>{key=value;return {body:new TextEncoder().encode('%PDF synthetic'),writeHttpMetadata:headers=>headers.set('Content-Type','application/pdf')};};
 const r=await request(f,'job-file?id=synthetic-download&job_id=9101');assert.equal(r.status,200);assert.equal(key,'synthetic/synthetic-download.pdf');assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');assert.match(await r.text(),/synthetic/);
}));


test('base staging hostname is pinned and alternate hosts deny pages and APIs before storage',async()=>fixture(async f=>{
 assert.equal(ACCEPTANCE_HOST,'solectrics-jobhub-staging.pages.dev');
 for(const host of ['usability-acceptance.solectrics-jobhub-staging.pages.dev','solectrics-jobhub-staging.pages.dev.attacker.invalid','preview.solectrics-jobhub-staging.pages.dev','solectrics.co.nz']){
  for(const route of ['/mini-fergus','/mini-fergus-job?id=9101','/api/job-hec?job_id=9101','/api/job-file?id=synthetic']){
   const before=f.counts();const c={env:f.env,data:{},request:new Request('https://'+host+route,{headers:{'Cf-Access-Jwt-Assertion':await auth.token()}}),next:()=>{throw Error('Alternate host must not reach application');}};
   assert.equal((await rootMiddleware(c)).status,403,host+route);assert.deepEqual(f.counts(),before);
  }
 }
}));
