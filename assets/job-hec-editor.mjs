import {HEC_FIELDS} from './hec-fields.mjs';
const jobId=Number(new URLSearchParams(location.search).get('id'));
const dirtyHosts=new Set();
window.addEventListener('beforeunload',e=>{if(dirtyHosts.size){e.preventDefault();e.returnValue='';}});
const node=(tag,text,parent)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;parent?.append(el);return el;};
async function api(body){
 const r=await fetch('/api/job-hec'+(body?'':'?job_id='+jobId),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:jobId,...body})}:{});
 if(r.redirected||!r.headers.get('content-type')?.includes('application/json'))throw Error('Sign-in or connection needs checking. Your edits are retained.');
 const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'HEC could not be saved.');return d;
}
function control(parent,field,value){
 const wrap=node('label',field.label,parent);wrap.className='hec-control';let input;
 if(field.type==='multi'){
 input=node('div',null,wrap);input.className='hec-multiple';
 for(const option of [...new Set([...field.options,...(Array.isArray(value)?value:[])])]){
 const label=node('label',null,input),check=node('input',null,label);check.type='checkbox';check.value=option;check.checked=(value||[]).includes(option);node('span',option,label);
 }
 }else{
 input=node(field.type==='select'?'select':'input',null,wrap);
 if(field.type==='select')for(const option of [...new Set(['',...field.options,...(value&&!field.options.includes(value)?[value]:[])])]){const o=node('option',option||'Unknown / not supplied',input);o.value=option;}
 else {input.type=field.type==='number'?'number':field.type==='date'?'date':'text';input.maxLength=2000;if(input.type==='number'){input.min='0';input.step='any';input.inputMode='decimal';}}
 input.value=value??'';
 }
 input.dataset.hecKey=field.key;
 return {wrap,input,read:()=>field.type==='multi'?[...input.querySelectorAll('input:checked')].map(e=>e.value):input.value===''?null:field.type==='number'?Number(input.value):input.value};
}
async function mount(){
 const display=document.getElementById('hecDisplaySection');if(!display||display.hidden||document.getElementById('hecEditorSection')||!jobId)return;
 const section=node('section');section.id='hecEditorSection';section.className='card solar-only';display.parentElement.tagName==='DETAILS'?display.parentElement.after(section):display.after(section);
 const shortcuts=document.querySelector('.jh-job-shortcuts');if(shortcuts){const link=node('a','Edit HEC',shortcuts);link.href='#hecEditorSection';}
 const details=node('details',null,section);details.className='hec-editor';node('summary','Edit or complete Home Energy Check',details);
 node('p','Review the saved answers before changing them. Originals and reasons are retained. Issued quotes and saved designs remain unchanged until reviewed.',details);
 const status=node('p','Loading saved HEC…',details);status.setAttribute('role','status');
 const content=node('div',null,details);let bundle,busy=false;
 const reload=node('button','Reload saved answers',details);reload.type='button';reload.onclick=()=>{if(!busy&&(!dirtyHosts.has(section)||confirm('Discard your unsaved HEC edits and load the latest saved answers?')))load();};
 async function saved(){dirtyHosts.delete(section);document.dispatchEvent(new CustomEvent('workspace:hec-saved'));await load();status.textContent='Saved. HEC and shared energy information updated. Assessment, Design and energy forecasts need review; issued quotes are unchanged.';}
 async function submit(form,payload){
 if(busy)return;const reason=form.querySelector('[data-reason]').value.trim(),approved=form.querySelector('[data-approve]').checked;
 if(!reason||!approved){status.textContent='Enter a reason and approve the reviewed changes.';return;}
 busy=true;form.querySelectorAll('button,input,select').forEach(x=>x.disabled=true);reload.disabled=true;
 try{await api({revision:bundle.revision,reason,approved, ...payload});await saved();}
 catch(e){status.textContent=e.message;form.querySelectorAll('button,input,select').forEach(x=>x.disabled=false);}
 finally{busy=false;reload.disabled=false;}
 }
 function approval(form,label){
 const r=node('label','Reason for this change',form),reason=node('input',null,r);reason.dataset.reason='';reason.required=true;reason.maxLength=1000;
 const a=node('label',null,form),check=node('input',null,a);check.type='checkbox';check.dataset.approve='';node('span',' I have reviewed these changes.',a);
 const button=node('button',label,form);button.type='submit';
 form.addEventListener('input',e=>{dirtyHosts.add(section);if(e.target!==check)check.checked=false;});
 return check;
 }
 function draw(){
 content.replaceChildren();
 const form=node('form',null,content);form.id='hecAnswersForm';const grid=node('div',null,form);grid.className='hec-fields';const controls=new Map();
 for(const field of HEC_FIELDS)controls.set(field.key,control(grid,field,bundle.values[field.key]));
 const conditions=()=>{for(const field of HEC_FIELDS)if(field.condition){const value=controls.get(field.condition.key).read();controls.get(field.key).wrap.hidden=!field.condition.values.some(v=>Array.isArray(value)?value.includes(v):value===v);}};
 form.addEventListener('input',conditions);conditions();approval(form,'Save reviewed HEC changes');
 form.onsubmit=e=>{e.preventDefault();const patch={};for(const [key,c]of controls){const value=c.read(),old=bundle.values[key]??null;if(JSON.stringify(value)!==JSON.stringify(old))patch[key]=value;}submit(form,{patch});};
 const billDetails=node('details',null,content);node('summary','Manually enter or correct electricity bill information',billDetails);
 node('p','Use this even if bill reading fails. Additional bills remain evidence; summer and winter are the seasonal calculation inputs. Unknown values are not zero.',billDetails);
 const upload=node('a','Upload an electricity bill or annual usage file',billDetails);upload.href='#jobFilesSection';upload.onclick=e=>{e.preventDefault();window.revealDocumentUpload?.('additional_power_bill');};
 const bf=node('form',null,billDetails);bf.id='hecManualBillForm';const label=node('label','Evidence to enter / correct',bf),slot=node('select',null,label);slot.id='hecBillSlot';
 for(const [value,text]of [['summer','Summer bill'],['winter','Winter bill'],['additional','New additional bill'],...(bundle.answers.additionalBills||[]).map(b=>['additional:'+b.id,'Correct additional bill '+b.id.slice(0,8)])]){const o=node('option',text,slot);o.value=value;}
 const attachLabel=node('label','Attached original (optional)',bf),attachment=node('select',null,attachLabel);attachment.id='hecBillAttachment';const blank=node('option','No attachment / manual record',attachment);blank.value='';
 fetch('/api/job-files?job_id='+jobId).then(r=>r.json()).then(data=>{for(const f of data.files||[])if(['power_bill','additional_power_bill'].includes(f.document_role)){const o=node('option',f.original_name,attachment);o.value=f.id;}}).catch(()=>{});
 const billGrid=node('div',null,bf);billGrid.className='hec-fields';let billControls;
 const fill=()=>{billGrid.replaceChildren();billControls=new Map();const bill=slot.value.startsWith('additional:')?(bundle.answers.additionalBills||[]).find(b=>b.id===slot.value.slice(11))?.bill:bundle.answers.bills?.[slot.value];
 for(const [key,label,type='text',options]of window.PostHecBill?.fields||[]){const c=control(billGrid,{key,label,type:type==='select'?'select':type,options},bill?.[key]);billControls.set(key,c);if(key==='average_daily_kwh')c.input.readOnly=true;}
 };fill();slot.onchange=()=>{fill();bf.querySelector('[data-approve]').checked=false;};
 bf.addEventListener('input',()=>{const total=billControls.get('total_import_kwh').read(),days=billControls.get('billing_days').read();billControls.get('average_daily_kwh').input.value=total!=null&&days>0?Number((total/days).toFixed(4)):'';});
 approval(bf,'Save reviewed bill information');
 bf.onsubmit=e=>{e.preventDefault();const values=Object.fromEntries([...billControls].map(([key,c])=>[key,c.read()]));submit(bf,{patch:{},bill:{slot:slot.value.split(':')[0],id:slot.value.includes(':')?slot.value.slice(11):undefined,file_id:attachment.value||undefined,values}});};
 const audit=node('details',null,content);node('summary','Original responses and change history',audit);
 const original=node('pre',null,audit);original.textContent=JSON.stringify(bundle.answers.hec_audit?.original||bundle.answers,null,2);
 for(const h of [...(bundle.history||[])].reverse()){const entry=node('details',null,audit);node('summary',h.at+' · '+h.actor+' · '+h.reason,entry);node('pre',JSON.stringify({before:h.before,after:h.after,bill:h.bill},null,2),entry);}
 for(const h of [...(bundle.answers.energy_data?.history||[])].reverse()){const entry=node('details',null,audit);node('summary',h.reviewed_at+' · Reviewed bill · '+h.slot,entry);node('pre',JSON.stringify(h,null,2),entry);}
 }
 async function load(){try{const next=await api();bundle=next;dirtyHosts.delete(section);draw();status.textContent='Saved answers loaded.';}catch(e){status.textContent=e.message;}}
 await load();
}
const page=document.getElementById('page');if(page)new MutationObserver(mount).observe(page,{childList:true});mount();
