import {HEC_FIELDS} from '../../assets/hec-fields.mjs';
import {usabilityLocal,localDenied} from './_usability-local.js';
import {energyRevision,parseEnergyAnswers,sharedIdentity,validateReviewedBill,applyReviewedBill} from './_post-hec-energy.js';
const fields=new Map(HEC_FIELDS.map(f=>[f.key,f]));
const headers={'Cache-Control':'no-store'};
const reply=(data,status=200)=>Response.json(data,{status,headers});
async function load(context,id){
 if(!Number.isInteger(id)||id<=0)return null;
 return context.env.DB.prepare(`SELECT j.id AS job_id,j.job_type,e.id AS enquiry_id,e.answers_json,
 e.customer_name,e.email,e.phone,e.address FROM jobs j JOIN enquiries e ON e.id=j.enquiry_id WHERE j.id=?`).bind(id).first();
}
export function validatePatch(patch){
 if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('Choose HEC fields to update.');
 const result={};
 for(const [key,value] of Object.entries(patch)){
 const f=fields.get(key);if(!f)throw Error('Unsupported HEC field: '+key);
 if(value===null){result[key]=null;continue;}
 if(f.type==='multi'){
 if(!Array.isArray(value)||value.some(v=>typeof v!=='string'||!f.options.includes(v)))throw Error('Check '+f.label);
 result[key]=[...new Set(value)];continue;
 }
 if(f.type==='number'){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e9)throw Error('Check '+f.label);
 result[key]=value;continue;
 }
 if(typeof value!=='string'||value.length>2000)throw Error('Check '+f.label);
 const text=value.trim();if(f.options&&text&&!f.options.includes(text))throw Error('Check '+f.label);
 if(key==='icp'&&text&&!/^[A-Z0-9]{15}$/.test(text.replace(/\s/g,'').toUpperCase()))throw Error('Enter the complete 15-character ICP.');
 if(key==='email'&&text&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))throw Error('Check email address.');
 result[key]=key==='icp'?text.replace(/\s/g,'').toUpperCase():text;
 }
 return result;
}
export async function onRequestGet(context){
 if(!usabilityLocal(context))return localDenied();
 try{
 const row=await load(context,Number(new URL(context.request.url).searchParams.get('job_id')));
 if(!row)return reply({ok:false,error:'Job not found'},404);
 if(row.job_type!=='solar')return reply({ok:false,error:'HEC editing is for solar jobs.'},400);
 const answers=parseEnergyAnswers(row.answers_json),identity=sharedIdentity(answers);
 const values={...answers,...identity};
 for(const [key,column]of Object.entries({name:'customer_name',email:'email',phone:'phone',address:'address'}))values[key]=row[column]??answers[key]??'';
 return reply({ok:true,answers,values,revision:await energyRevision(row.answers_json),fields:HEC_FIELDS,history:answers.hec_audit?.history||[]});
 }catch{return reply({ok:false,error:'Saved HEC cannot be read. No update was made.'},409);}
}
export async function onRequestPost(context){
 if(!usabilityLocal(context))return localDenied();
 try{
 const body=await context.request.json(),row=await load(context,Number(body.job_id));
 if(!row)return reply({ok:false,error:'Job not found'},404);
 if(row.job_type!=='solar')return reply({ok:false,error:'HEC editing is for solar jobs.'},400);
 if(body.approved!==true||typeof body.reason!=='string'||!body.reason.trim())return reply({ok:false,error:'Review the changes, enter a reason and approve saving.'},400);
 const before=parseEnergyAnswers(row.answers_json);
 if(body.revision!==await energyRevision(row.answers_json))return reply({ok:false,error:'HEC changed since you opened it. Your edits have not been saved. Reload and compare.'},409);
 const patch=validatePatch(body.patch||{}),now=new Date().toISOString(),previous={};
 let next={...before};
 for(const [key,value]of Object.entries(patch))if(JSON.stringify(value)!==JSON.stringify(before[key])){previous[key]=before[key]??null;next[key]=value;}
 if(['icp','retailer','plan_name'].some(k=>Object.hasOwn(patch,k))){
 next.hec_identity={...sharedIdentity(before)};
 for(const key of ['icp','retailer','plan_name'])if(Object.hasOwn(patch,key))next.hec_identity[key]=patch[key]??'';
 }
 let evidence=null;
 if(body.bill){
 const {slot,file_id}=body.bill;
 if(!['summer','winter','additional'].includes(slot))throw Error('Choose a valid bill evidence slot.');
 let file={id:null,original_name:'Manual entry'};
 if(file_id){file=await context.env.DB.prepare("SELECT id,original_name FROM job_files WHERE id=? AND job_id=? AND document_role IN ('power_bill','additional_power_bill')").bind(String(file_id),row.job_id).first();if(!file)return reply({ok:false,error:'Bill attachment does not belong to this job.'},404);}
 const bill=validateReviewedBill(body.bill.values);
 if(bill.icp&&!/^[A-Z0-9]{15}$/.test(bill.icp.replace(/\s/g,'').toUpperCase()))throw Error('Check the bill ICP.');
 const prior=slot==='additional'?(before.additionalBills||[]).find(b=>b.id===body.bill.id)?.bill:before.bills?.[slot];
 const reviewed={...prior,...bill};
 evidence={slot,previous:prior??null,reviewed,file_id:file.id,source:'staff_manual_review'};
 if(slot==='additional'){
 const items=[...(before.additionalBills||[])];let index=body.bill.id?items.findIndex(b=>b.id===body.bill.id):-1;
 if(body.bill.id&&index<0)throw Error('Additional bill no longer exists. Reload before correcting it.');
 const entry={id:body.bill.id||crypto.randomUUID(),bill:reviewed,file_id:file.id,reviewed_at:now};if(index<0)items.push(entry);else items[index]=entry;next.additionalBills=items;
 }else{
 next=applyReviewedBill(next,{file,draft:{extracted:null,extracted_at:null},bill:reviewed,slot,now});
 const identity=sharedIdentity(next);next.hec_identity={...identity};
 for(const key of ['icp','retailer','plan_name'])if(bill[key]!=null&&bill[key]!=='')next.hec_identity[key]=bill[key];
 }
 }
 if(!Object.keys(previous).length&&!evidence)return reply({ok:true,unchanged:true,revision:body.revision});
 next.energy_data={...(next.energy_data||{}),revision:crypto.randomUUID(),review_required:true};
 next.hec_audit={original:before.hec_audit?.original??before,history:[...(before.hec_audit?.history||[]),{id:crypto.randomUUID(),at:now,actor:'local-synthetic-staff',reason:body.reason.trim().slice(0,1000),before:previous,after:Object.fromEntries(Object.keys(previous).map(k=>[k,next[k]])),bill:evidence}]};
 const json=JSON.stringify(next);
 if(json.length>2*1024*1024)return reply({ok:false,error:'HEC history needs archival review before another update.'},409);
 const contact=Object.fromEntries(Object.entries({name:'customer_name',email:'email',phone:'phone',address:'address'}).map(([key,column])=>[column,Object.hasOwn(patch,key)?(patch[key]??''):row[column]]));
 const update=await context.env.DB.prepare(`UPDATE enquiries SET answers_json=?,customer_name=?,email=?,phone=?,address=? WHERE id=? AND answers_json IS ?`).bind(json,contact.customer_name,contact.email,contact.phone,contact.address,row.enquiry_id,row.answers_json).run();
 if(update.meta?.changes!==1)return reply({ok:false,error:'Concurrent HEC update detected. Nothing was overwritten. Reload and compare.'},409);
 return reply({ok:true,revision:await energyRevision(json),review_required:true});
 }catch(error){return reply({ok:false,error:error.message||'HEC update failed. No update was made.'},400);}
}
