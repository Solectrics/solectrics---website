// Preliminary security reference: 514781021009dec8e5018c056d7e15851b137fb7.
// This adapter does not change that reference or claim equivalence to f42de493.
import {authenticateAccessRequest,withPrivateNoStore,requireExistingJob,requireRelatedRecord,requireJobFile} from './_access-security.js';
export const ACCEPTANCE_HOST='usability-acceptance.solectrics-jobhub-staging.pages.dev';
const verified=new WeakSet();
export const stagingIntent=c=>new URL(c.request.url).hostname===ACCEPTANCE_HOST || c.env?.JOBHUB_USABILITY_STAGING==='true';
export function stagingStaff(c){const staff=c.data?.usabilityStaff;return new URL(c.request.url).hostname===ACCEPTANCE_HOST&&c.env?.JOBHUB_USABILITY_STAGING==='true'&&verified.has(staff)?staff:null;}
export const staffActor=c=>stagingStaff(c)?.subject || 'local-synthetic-staff';
export const staffAudit=c=>stagingStaff(c)?{subject:stagingStaff(c).subject,email:stagingStaff(c).email}:null;
const fail=(message,status=403)=>Response.json({ok:false,error:message},{status,headers:{'Cache-Control':'private, no-store'}});
const outbound=new Set(['/api/read-bill','/api/fletcher-email','/api/fletcher-quote-import','/api/supplier-invoice-read','/api/enquiry']);
const jobRoutes=new Set(['assessment','site-visit','system-design','energy-review','job-hec','job-files','job-work-logs','job-materials','job-materials-import','job-costing','job-supplier-pricing','general-job-details']);
const globalRoutes=new Set(['jobs','supplier-products','catalogue-import']);
async function scope(c){
 const url=new URL(c.request.url),route=url.pathname.slice(5),db=c.env.DB;
 let body={};
 if(!['GET','HEAD'].includes(c.request.method)){
  const type=(c.request.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
  if(type==='multipart/form-data'){const form=await c.request.clone().formData();body=Object.fromEntries([...form].filter(([,v])=>typeof v==='string'));}
  else body=await c.request.clone().json();
  if(!body||typeof body!=='object'||Array.isArray(body))return fail('Invalid request.',400);
 }
 if(outbound.has(url.pathname)||body.action==='read_energy_bill')return fail('External processing and customer submissions are disabled during synthetic staff acceptance. Use manual bill entry.');
 const queryJob=url.searchParams.get('job_id'),rawJob=body.job_id??queryJob;
 if(body.job_id!==undefined&&queryJob!==null&&Number(body.job_id)!==Number(queryJob))return fail('Conflicting job identifiers.',400);
 let jobId=rawJob==null?null:Number(rawJob);
 if(rawJob!=null&&(!Number.isSafeInteger(jobId)||jobId<=0))return fail('A valid job is required.',400);
 if(route==='job'){jobId=c.request.method==='GET'?Number(url.searchParams.get('id')):jobId;if(!Number.isSafeInteger(jobId)||jobId<=0)return fail('A valid job is required.',400);}
 if(route==='job-file'){
  const id=url.searchParams.get('id');if(!id)return fail('File ID required.',400);
  if(!await requireJobFile(db,id,jobId??undefined))return fail('File not found.',404);return null;
 }
 if(route==='job-document-inventory'){
  const ids=[...new Set((url.searchParams.get('job_ids')||url.searchParams.get('job_id')||'').split(',').map(Number))];
  if(!ids.length||ids.length>50||ids.some(id=>!Number.isSafeInteger(id)||id<=0))return fail('Supply valid jobs.',400);
  for(const id of ids)if(!await requireExistingJob(db,id))return fail('Job not found.',404);return null;
 }
 if(['customer-quotes','customer-invoices'].includes(route)){
  const key=route==='customer-quotes'?'quote_id':'invoice_id',table=route==='customer-quotes'?'customer_quote_versions':'customer_invoice_versions';
  const id=body[key]??url.searchParams.get(key);
  if(id){if(!await requireRelatedRecord(db,table,id,jobId==null?{}:{jobId}))return fail('Record not found for this job.',404);return null;}
  if(jobId==null)return fail('A valid job is required.',400);
 }
 if(route==='job-tasks'&&jobId==null){if(c.request.method!=='GET'&&body.action!=='update_settings')return fail('A valid job is required.',400);return null;}
 if(jobId!=null){if(!await requireExistingJob(db,jobId))return fail('Job not found.',404);}
 else if(jobRoutes.has(route))return fail('A valid job is required.',400);
 if(!jobRoutes.has(route)&&!globalRoutes.has(route)&&!['job','job-tasks','customer-quotes','customer-invoices'].includes(route))return fail('Unknown private route.',404);
 const fileId=body.file_id??body.invoice_file_id??body.bill?.file_id;
 if(fileId&&!await requireJobFile(db,fileId,jobId))return fail('File not found for this job.',404);
 if(route==='job-files'&&c.request.method==='PATCH'&&!await requireJobFile(db,body.id,jobId))return fail('File not found for this job.',404);
 const strict=[];
 if(route==='job-work-logs'&&body.id)strict.push(['job_work_logs',body.id]);
 if(route==='job-materials'&&(body.id||url.searchParams.get('id')))strict.push(['job_materials',body.id||url.searchParams.get('id')]);
 if(route==='energy-review'&&body.tariff_id)strict.push(['job_energy_tariffs',body.tariff_id]);
 for(const [table,id]of strict)if(!await requireRelatedRecord(db,table,id,{jobId}))return fail('Related record not found for this job.',404);
 for(const [table,id]of [['costing_options',body.option?.id],['job_energy_tariffs',body.tariff?.id],...(route==='job-costing'?(body.lines||[]).map(l=>['costing_lines',l.id]):[])]){
  if(!id)continue;const row=await db.prepare(`SELECT job_id FROM ${table} WHERE id=?`).bind(String(id)).first();if(row&&Number(row.job_id)!==jobId)return fail('Related record belongs to another job.',404);
 }
 return null;
}
export async function stagingGate(c,{api=false}={}){
 const url=new URL(c.request.url),env=c.env||{};
 if(url.hostname!==ACCEPTANCE_HOST||env.JOBHUB_USABILITY_STAGING!=='true'||env.JOBHUB_STAGING_ONLY!=='true'||env.ALLOW_PAGES_DEV_HOST!=='true')return fail('Staging acceptance is not enabled for this hostname.');
 let audiences;try{audiences=JSON.parse(env.JOBHUB_ACCESS_AUDIENCES||'{}');}catch{return fail('Invalid staging authentication configuration.');}
 if(!audiences||typeof audiences!=='object'||Array.isArray(audiences)||typeof audiences[ACCEPTANCE_HOST]!=='string'||!audiences[ACCEPTANCE_HOST].trim()||Object.keys(audiences).some(k=>k.includes('*')))return fail('Exact staging audience configuration required.');
 const auth=await authenticateAccessRequest(c);if(!auth.ok)return auth.response;
 if(!['GET','HEAD'].includes(c.request.method)){
  if(c.request.headers.get('Origin')!==url.origin)return fail('Same-origin mutation required.');
  const type=(c.request.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
  if(type!=='application/json'&&!(url.pathname==='/api/job-files'&&c.request.method==='POST'&&type==='multipart/form-data'))return fail('Unsupported mutation content type.',415);
 }
 if(!env.DB||!env.JOB_FILES)return fail('Explicit staging DB and JOB_FILES bindings are required.',503);
 c.data??={};const identity=Object.freeze({...auth.identity});verified.add(identity);c.data.usabilityStaff=identity;
 try{if(api){const denial=await scope(c);if(denial)return denial;}return withPrivateNoStore(await c.next());}
 catch{return fail('Staging request failed safely.',503);}
}
