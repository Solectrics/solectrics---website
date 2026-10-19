(function(root){
  'use strict';
  const contexts={
    'roof-measurements':{label:'Roof measurements',category:'roof',field:'visit_roof_length',position:'after-grid'},
    'roof-condition':{label:'Roof condition and shading',category:'roof',field:'visit_roof_notes'},
    'switchboard':{label:'Switchboard',category:'switchboard',field:'visit_switchboard',position:'after-grid'},
    'meter':{label:'Meter / ICP',category:'meter',field:'visit_supply_notes'},
    'inverter-location':{label:'Inverter location',category:'equipment',field:'visit_inverter_location'},
    'battery-location':{label:'Battery location',category:'equipment',field:'visit_battery_location'},
    'cable-route':{label:'Cable route',category:'cable_route',field:'visit_cable_route'},
    'access':{label:'Access / safety',category:'site_photo',field:'visit_access_notes'}
  };
  const marker=context=>`[Site visit: ${context}]`;
  function contextFor(file){const match=String(file.caption||'').match(/^\[Site visit: ([a-z-]+)\]/);return match&&contexts[match[1]]&&file.document_role==='general'&&file.category===contexts[match[1]].category?match[1]:null;}
  function displayCaption(file){const context=contextFor(file);return context?contexts[context].label+' photograph':String(file.caption||'');}
  function receiptMatches(files,caption){return files.filter(file=>file.caption===caption);}
  async function sendPhoto(item,jobId,request=root.fetch){
    if(!['queued','failed'].includes(item.state))return item;
    item.state='uploading';
    const form=new FormData();form.append('job_id',String(jobId));form.append('file',item.file);form.append('category',contexts[item.context].category);form.append('document_role','general');form.append('caption',item.caption);
    try{
      const response=await request('/api/job-files',{method:'POST',body:form});
      if(response.redirected)throw new Error('Authentication redirected the upload');
      const data=await response.json();
      if(!response.ok||!data.ok){if(data.ok===false){item.state='failed';item.message=data.detail||data.error||'Upload rejected';return item;}throw new Error('Unexpected upload response');}
      if(!data.id)throw new Error('Upload did not return an attachment ID');
      item.state='saved';item.id=data.id;item.message='Saved to this job';
    }catch(error){item.state='unconfirmed';item.message='Save unconfirmed. Check saved files before trying another upload.';}
    return item;
  }
  let jobId=null,section=null,refreshFiles=null,lastFiles=null,recoveryPending=false;
  const queues=new Map(), controls=new Map();
  function fields(){return [...section.querySelectorAll('input[id^="visit_"],select[id^="visit_"],textarea[id^="visit_"]')];}
  function values(){return Object.fromEntries(fields().map(field=>[field.id,field.type==='checkbox'?field.checked:field.value]));}
  function draftKey(){return 'site-visit-draft:'+jobId;}
  function storeDraft(){if(!section||recoveryPending)return;try{localStorage.setItem(draftKey(),JSON.stringify({jobId,values:values(),updatedAt:Date.now()}));}catch{const notice=section.querySelector('.svp-draft-status');if(notice)notice.textContent='Local draft recovery is unavailable. Check normal save feedback before leaving the page.';}}
  function offerDraft(){
    let draft;try{draft=JSON.parse(localStorage.getItem(draftKey())||'null');}catch{return;}
    if(!draft||String(draft.jobId)!==String(jobId)||!draft.values||typeof draft.values!=='object')return;
    const live=values();if(!Object.keys(live).some(id=>Object.hasOwn(draft.values,id)&&draft.values[id]!==live[id]))return;
    recoveryPending=true;const panel=document.createElement('div');panel.className='svp-draft-notice';panel.setAttribute('role','status');const text=document.createElement('p');text.textContent='A different Site Visit draft is saved on this device. Restore it or keep the server-loaded values.';panel.append(text);
    const restore=document.createElement('button');restore.type='button';restore.textContent='RESTORE DEVICE DRAFT';restore.onclick=()=>{recoveryPending=false;for(const field of fields()){if(!Object.hasOwn(draft.values,field.id))continue;const value=draft.values[field.id];if(field.type==='checkbox'){if(typeof value==='boolean')field.checked=value;}else if(typeof value==='string')field.value=value;}storeDraft();panel.remove();const message=document.getElementById('siteVisitMessage');if(message)message.textContent='Device draft restored. Review it; your next edit uses normal autosave.';};
    const discard=document.createElement('button');discard.type='button';discard.textContent='KEEP LOADED VALUES';discard.onclick=()=>{recoveryPending=false;storeDraft();panel.remove();};panel.append(restore,discard);section.querySelector('h2')?.after(panel);
  }
  function button(text,handler){const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',handler);return b;}
  function image(file,id){const a=document.createElement('a');a.href='/api/job-file?id='+encodeURIComponent(id);a.target='_blank';a.rel='noopener';a.className='svp-thumbnail';const img=document.createElement('img');img.src=a.href;img.alt=file.original_name||'Site photograph';img.loading='lazy';img.onerror=()=>{img.hidden=true;a.textContent='OPEN PHOTO';};a.append(img);return a;}
  function drawQueue(context){const control=controls.get(context);if(!control)return;const list=control.pending;list.replaceChildren();for(const item of queues.get(context)||[]){if(item.state==='saved'&&lastFiles?.some(file=>file.id===item.id))continue;const row=document.createElement('div');row.className='svp-photo-row';const name=document.createElement('strong');name.textContent=item.file.name;const status=document.createElement('span');status.className='svp-upload-state';status.textContent=item.state==='uploading'?'Uploading this photo…':item.message||'Waiting to upload';row.append(name,status);if(item.state==='failed')row.append(button('RETRY THIS PHOTO',()=>uploadItem(item)));if(item.state==='unconfirmed')row.append(button('CHECK SAVED FILES',()=>checkReceipt(item)));if(item.state==='saved'){const link=document.createElement('a');link.href='/api/job-file?id='+encodeURIComponent(item.id);link.target='_blank';link.rel='noopener';link.textContent='OPEN SAVED PHOTO';row.append(link);}list.append(row);}}
  async function uploadItem(item){if(!['queued','failed'].includes(item.state))return;const promise=sendPhoto(item,jobId);drawQueue(item.context);await promise;drawQueue(item.context);if(item.state==='saved'&&refreshFiles){try{await refreshFiles();}catch{controls.get(item.context).message.textContent='Photo saved; the library could not refresh. Reopen Documents to check it.';}}}
  async function checkReceipt(item){if(item.checking)return;item.checking=true;const control=controls.get(item.context);control.message.textContent='Checking the job’s saved attachment records…';try{const response=await fetch('/api/job-files?job_id='+encodeURIComponent(jobId));if(response.redirected)throw new Error();const data=await response.json();if(!response.ok||!data.ok||!Array.isArray(data.files))throw new Error();const matches=receiptMatches(data.files,item.caption);if(matches.length===1){item.state='saved';item.id=matches[0].id;item.message='Saved attachment confirmed';renderSaved(data.files);if(refreshFiles)await refreshFiles();}else{item.message=matches.length?'More than one matching receipt: review Documents. No further upload sent.':'No receipt confirmed yet. The earlier request may still be processing; no retry was sent.';}drawQueue(item.context);control.message.textContent=item.message;}catch{control.message.textContent=item.state==='saved'?'Save confirmed, but the document library could not refresh. No upload was retried.':'Could not verify saved files. No upload was retried.';}finally{item.checking=false;}}
  async function selectFiles(context,input){
    storeDraft();const control=controls.get(context),files=[...input.files];input.value='';if(!files.length)return;
    const queue=queues.get(context);for(const file of files){const token=crypto.randomUUID();const item={file,context,caption:marker(context)+' [capture: '+token+']',state:'queued'};if(!/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)||!['image/jpeg','image/png','image/webp','image/heic','image/heif',''].includes(file.type)){item.state='invalid';item.message='Choose a supported photo: JPEG, PNG, WebP, HEIC or HEIF.';}else if(!file.size||file.size>12*1024*1024){item.state='invalid';item.message='Choose a non-empty photo under 12 MB.';}queue.push(item);}
    drawQueue(context);for(const item of queue){if(item.state==='queued')await uploadItem(item);}control.message.textContent='Each photo has its own save status above. Confirmed saves are also in Photos & Documents.';
  }
  function renderSaved(files){lastFiles=files;if(!section)return;for(const [context,control] of controls){control.gallery.replaceChildren();const matches=files.filter(file=>contextFor(file)===context);control.count.textContent=matches.length+' saved';for(const file of matches){const row=document.createElement('div');row.className='svp-saved-photo';row.append(image(file,file.id));const label=document.createElement('span');label.textContent='✓ Saved · '+(file.original_name||'Site photograph');row.append(label);control.gallery.append(row);}drawQueue(context);}}
  function init(id,refresh){
    section=document.getElementById('siteVisitSection');if(!section||section.dataset.contextPhotos)return;section.dataset.contextPhotos='true';jobId=String(id);refreshFiles=refresh;
    const draftStatus=document.createElement('p');draftStatus.className='svp-draft-status';draftStatus.textContent='Site Visit values are kept as a device draft while you use the camera. Normal autosave remains unchanged. Earlier unclassified photos remain in Documents.';section.querySelector('h2')?.after(draftStatus);offerDraft();
    const draftEdit=event=>{if(!event.target.id?.startsWith('visit_'))return;if(recoveryPending){recoveryPending=false;section.querySelector('.svp-draft-notice')?.remove();}storeDraft();};section.addEventListener('input',draftEdit);section.addEventListener('change',draftEdit);window.addEventListener('pagehide',storeDraft);
    for(const [context,config] of Object.entries(contexts)){
      const field=document.getElementById(config.field);if(!field)continue;const anchor=config.position==='after-grid'?field.closest('.grid'):field.parentElement;const control=document.createElement('div');control.className='svp-control';control.dataset.photoContext=context;const heading=document.createElement('h4');heading.textContent=config.label+' photographs';const count=document.createElement('span');count.className='svp-count';heading.append(' · ',count);control.append(heading);
      const camera=document.createElement('input');camera.type='file';camera.accept='image/jpeg,image/png,image/webp,image/heic,image/heif';camera.setAttribute('capture','environment');camera.hidden=true;camera.setAttribute('aria-label','Take '+config.label.toLowerCase()+' photograph');
      const picker=document.createElement('input');picker.type='file';picker.accept=camera.accept;picker.multiple=true;picker.hidden=true;picker.setAttribute('aria-label','Choose '+config.label.toLowerCase()+' photographs');
      const actions=document.createElement('div');actions.className='svp-actions';actions.append(button('TAKE PHOTO',()=>{storeDraft();camera.click();}),button('CHOOSE PHOTOS',()=>{storeDraft();picker.click();}));control.append(actions,camera,picker);
      const pending=document.createElement('div'),gallery=document.createElement('div'),message=document.createElement('p');gallery.className='svp-gallery';message.className='svp-message';message.setAttribute('role','status');message.setAttribute('aria-live','polite');const link=document.createElement('a');link.href='#jobFilesSection';link.textContent='VIEW IN PHOTOS & DOCUMENTS';control.append(pending,gallery,message,link);anchor.after(control);controls.set(context,{gallery,pending,message,count});queues.set(context,[]);camera.addEventListener('change',()=>selectFiles(context,camera));picker.addEventListener('change',()=>selectFiles(context,picker));
    }
    if(lastFiles)renderSaved(lastFiles);else if(refreshFiles)refreshFiles().catch(()=>{for(const control of controls.values())control.message.textContent='Could not load saved photographs. Check Documents.';});
  }
  root.SiteVisitPhotos={init,renderSaved,contextFor,displayCaption,receiptMatches,sendPhoto,storeDraft,contexts};
})(globalThis);
