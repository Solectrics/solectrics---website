import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../mini-fergus-fletcher-form.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function harness(fetchImpl, files = [{document_role:'roof_layout'}, {document_role:'power_bill'}], realValidation = false, inventoryResponse = ok({ok:true,jobs:[{id:7,files:[]}]})) {
  const events = [], elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { value: id === 'customerName' ? 'Synthetic Customer' : '', checked:false, disabled:false, textContent:'', href:'', addEventListener(){} });
    return elements.get(id);
  };
  const page = { drawText(){} };
  const context = vm.createContext({
    document: {getElementById:get, querySelectorAll:()=>[], createElement:()=>({click(){ events.push('download'); }})},
    location: {search:'?job_id=7'}, URLSearchParams,
    URL: {createObjectURL:()=> 'blob:test', revokeObjectURL(){}},
    Blob: class {}, File: class {}, FormData: class {append(){}},
    setTimeout(){}, console: {error(){}},
    PDFLib: {rgb(){}, PDFDocument:{load:async()=>({getPages:()=>[page,page], save:async()=>new Uint8Array([1,2])})}},
    fetch: async (url, options) => {if(url.startsWith('/api/job-document-inventory?')) return inventoryResponse;if(options?.body && typeof options.body === 'string' && JSON.parse(options.body).action==='preview')return ok({ok:true,preview_id:'synthetic-preview',preview:{}});events.push(url);if(url.startsWith('/api/job-files?'))return ok({ok:true,files});return fetchImpl(url, options);}
  });
  context.window = context;
  vm.runInContext(script.slice(0, script.lastIndexOf('document.querySelectorAll("input,select,textarea").forEach')), context);
  vm.runInContext('confirmPackagePreview = async () => true;',context);
  if (!realValidation) vm.runInContext('updateMissing = () => [];', context);
  return {context, events, get, run:code=>vm.runInContext(code, context)};
}
const ok = data => ({ok:true,status:200,redirected:false,json:async()=>data});
const template = {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)};

test('PDF is saved before the download can navigate an iPhone away', async()=>{
  let release;
  const h=harness(url=> url.includes('/assets/') ? template : new Promise(resolve=>{release=resolve;}));
  const pending=h.run('createAndSavePdf(true)');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.events.includes('download'),false);
  assert.equal(h.get('downloadPdf').disabled,true);
  assert.equal(h.get('emailPackage').disabled,true);
  release(ok({ok:true,id:'pdf'})); await pending;
  assert.deepEqual(h.events,['/assets/fletcher-solar-site-checklist.pdf','/api/job-files','download']);
  assert.equal(h.get('downloadPdf').disabled,false);
});
test('failed PDF save never opens a download or sends an email',async()=>{
  const h=harness(url=>url.includes('/assets/')?template:Promise.reject(new TypeError('Load failed')));
  await h.run('emailPackage()');
  assert.equal(h.events.includes('/api/fletcher-email'),false);
  assert.equal(h.events.includes('download'),false);
  assert.match(h.get('status').textContent,/PDF save lost its connection.*Saving is unconfirmed/);
});
test('email connection loss is unconfirmed, never retried automatically',async()=>{
  const h=harness(url=>url.includes('/assets/')?template:url==='/api/job-files'?ok({ok:true}):Promise.reject(new TypeError('Load failed')));
  await h.run('emailPackage()');
  assert.equal(h.events.filter(x=>x==='/api/fletcher-email').length,1);
  assert.match(h.get('status').textContent,/Delivery is unconfirmed.*before sending again/);
});
test('both buttons stay locked through email and repeated taps do not submit',async()=>{
  let release;
  const h=harness(url=>url.includes('/assets/')?template:url==='/api/job-files'?ok({ok:true}):new Promise(resolve=>{release=resolve;}));
  const pending=h.run('emailPackage()'); await new Promise(resolve=>setImmediate(resolve));
  await h.run('emailPackage()');await h.run('createAndSavePdf(true)');
  assert.equal(h.get('emailPackage').disabled,true);
  assert.equal(h.get('downloadPdf').disabled,true);
  release(ok({ok:true,recipient:'jane@solectrics.co.nz',missing:['Roof / panel layout']}));await pending;
  assert.equal(h.events.filter(x=>x==='/api/job-files').length,1);
  assert.equal(h.events.filter(x=>x==='/api/fletcher-email').length,1);
  assert.match(h.get('status').textContent,/provider accepted.*Inbox delivery is not yet confirmed.*Roof \/ panel layout/);
});
test('redirects and non-JSON responses are explained without retrying',async()=>{
  for(const response of [{redirected:true,status:200}, {redirected:false,status:502,json:async()=>{throw Error('html');}}]) {
    const h=harness(()=>response);
    await assert.rejects(h.run('packageRequest("/api/fletcher-email", {}, "email")'),/redirected|unreadable response/);
    assert.equal(h.events.length,1);
  }
});
test('provider rejection retains the specific returned error',async()=>{
  const h=harness(()=>({ok:false,status:503,redirected:false,json:async()=>({ok:false,detail:'Email is not connected'})}));
  await assert.rejects(h.run('packageRequest("/api/fletcher-email", {}, "email")'),/Email is not connected/);
});
test('layout shortcut reuses the same job documents and flags reflect actual files',()=>{
  const h=harness(()=>{});
  assert.equal(h.get('layoutUploadLink').href,'/mini-fergus-job?id=7&document_use=roof_layout&document_context=fletcher#jobFilesSection');
  assert.match(html,/setChecked\("plansAttached", layout.verified \|\| sld.verified\)/);
  assert.match(html,/<input type="checkbox" id="plansAttached" disabled>/);
  assert.match(html,/setChecked\("powerBillAttached", false\)/);
  assert.doesNotMatch(html,/setChecked\("plansAttached", Boolean\(design/);
});
test('missing layout stops before PDF save and email',async()=>{
  for(const files of [[],[{document_role:'power_bill'}]]) {
    const h=harness(()=>{throw Error('No write expected');},files);
    await h.run('emailPackage()');
    assert.deepEqual(h.events,['/api/job-files?job_id=7']);
    assert.match(h.get('status').textContent,/Upload these documents/);
  }
});
test('address starts inside the white field rather than on its title',()=>{
  assert.match(html,/drawText\(p1, \$\("siteAddress"\).value, 132, 626, \{ maxWidth:416 \}\)/);
});

const completeForm = h => {
  for (const [id, value] of Object.entries({customerName:'Synthetic Customer',siteAddress:'Synthetic address',connectionType:'single_phase',inverterType:'hybrid_ready',roofType:'corrugated_steel',roofPitch:'3',arrayLayout:'20 panels',systemSize:'9'})) h.get(id).value=value;
};
test('real form validation allows PDF download with only a power bill and no layout or SLD', async()=>{
  const h=harness(url=>url.includes('/assets/')?template:ok({ok:true}),[{document_role:'power_bill'}],true);
  completeForm(h); h.run('renderPackageDocuments([{document_role:"power_bill"}], {})');
  await h.run('createAndSavePdf(true)');
  assert.equal(h.events.includes('download'),true);
  assert.equal(h.events.includes('/api/fletcher-email'),false);
  assert.match(h.get('emailRequirements').textContent,/missing OpenSolar roof \/ panel layout/);
  assert.match(h.get('downloadRequirements').textContent,/PDF ready/);
});
test('real form validation names missing details beside the buttons without a write', async()=>{
  const h=harness(()=>{throw Error('No request expected');},[],true);
  await h.run('createAndSavePdf(true)');
  assert.deepEqual(h.events,[]);
  assert.match(h.get('status').textContent,/Site address.*Roof pitch/);
  assert.match(h.get('downloadRequirements').textContent,/Attachments are not required/);
  assert.equal(h.get('downloadPdf').disabled,false);
});
test('email with real valid form works without an SLD when bill and layout exist',async()=>{
  const h=harness(url=>url.includes('/assets/')?template:ok({ok:true,recipient:'jane@solectrics.co.nz'}),undefined,true);
  completeForm(h); await h.run('emailPackage()');
  assert.equal(h.events.filter(url=>url==='/api/fletcher-email').length,1);
  assert.equal(h.events.includes('download'),false);
});


test('Plans indicator requires accessible explicitly classified attachment; SLD never confirms layout',()=>{
 const h=harness(()=>{});
 const layout={id:1,document_role:'roof_layout',original_name:'OpenSolar layout.png'};
 const sld={id:2,document_role:'sld',original_name:'design.png'};
 const render=(files,verified)=>h.run(`renderPackageDocuments(${JSON.stringify(files)}, {}, ${JSON.stringify(verified)});`);
 render([layout],undefined);assert.equal(h.get('plansAttached').checked,false);
 render([layout],[{...layout,accessibility:'unavailable'}]);assert.equal(h.get('plansAttached').checked,false);
 render([{...layout,document_role:'general',original_name:'roof layout.png'}],[{...layout,document_role:'general',accessibility:'accessible'}]);assert.equal(h.get('plansAttached').checked,false);
 render([layout],[{...layout,id:99,accessibility:'accessible'}]);assert.equal(h.get('plansAttached').checked,false);
 render([layout],[{...layout,accessibility:'accessible'}]);assert.equal(h.get('plansAttached').checked,true);
 render([sld],[{...sld,accessibility:'accessible'}]);assert.equal(h.get('plansAttached').checked,true);
 assert.match(h.get('packageDocuments').innerHTML,/Roof \/ panel layout — Not attached/);
 assert.match(h.get('packageDocuments').innerHTML,/does not replace the required OpenSolar layout/);
 render([{...layout,original_name:'electricity bill.pdf'}],[{...layout,accessibility:'accessible'}]);assert.equal(h.get('plansAttached').checked,false);
});
test('verification outage clears plan receipt without preventing PDF download',async()=>{
 const h=harness(url=>url.includes('/assets/')?template:ok({ok:true}),[],true,{ok:false,status:503});completeForm(h);
 h.get('plansAttached').checked=true;
 await h.run('verifyPackagePlans([{id:1,document_role:"roof_layout"}], {})');
 assert.equal(h.get('plansAttached').checked,false);
 assert.match(h.get('packageDocuments').innerHTML,/Needs review/);
 await h.run('createAndSavePdf(true)');assert.equal(h.events.includes('download'),true);
 assert.equal(h.events.includes('/api/fletcher-email'),false);
});

test('supplier preview maps every checkbox to its own answer, including opposing shading values',()=>{
  const h=harness(()=>{});
  const expected={plansAttached:'Verified plan attachment available',saltSpray:'Salt spray',snowIce:'Snow and ice',highWind:'High wind area',trees:'Trees and vegetation',chimneys:'Chimneys',buildings:'Buildings',aerials:'TV aerials',vents:'Vent pipes',satellite:'Satellite dish',noShading:'No shading issues'};
  for(const selected of Object.keys(expected)) {
    for(const id of Object.keys(expected)) h.get(id).checked=id===selected;
    const answers=h.run('supplierPreviewAnswers()');
    for(const [id,label] of Object.entries(expected)) {
      const answer=answers.find(a=>a.id===id);
      assert.equal(answer.label,label);assert.equal(answer.value,id===selected?'Yes':'No');
    }
  }
  assert.match(html,/supplierPreviewAnswers\(\)\.forEach/);
  assert.doesNotMatch(html,/field\.closest\("div"\)/);
});
test('supplier preview includes only explicit form fields and opt-in ICP, with readable select answers',()=>{
  const h=harness(()=>{});
  const expected={installerCode:'Installer account code',customerName:'Customer name',siteAddress:'Site address',suburb:'Suburb',cityPostcode:'City and postcode',connectionType:'Electrical connection type',inverterType:'Inverter type',roofType:'Roof type',roofOther:'Other roof type / profile',roofPitch:'Roof pitch',arrayLayout:'Proposed array layout',systemSize:'Proposed system size (kW)',otherEnvironment:'Other environment / shading issue',additionalNotes:'Additional supplier notes'};
  for(const id of Object.keys(expected)) h.get(id).value=`synthetic-${id}`;
  h.get('roofType').tagName='SELECT';h.get('roofType').selectedOptions=[{textContent:'Corrugated steel'}];
  h.get('icp').value='000000000AA000A';h.get('powerBillAttached').checked=true;h.get('internalProfit').value='PRIVATE';
  let answers=h.run('supplierPreviewAnswers()');
  for(const [id,label] of Object.entries(expected)) {const a=answers.find(a=>a.id===id);assert.equal(a.label,label);assert.equal(a.value,id==='roofType'?'Corrugated steel':`synthetic-${id}`);}
  assert.equal(answers.some(a=>['icp','powerBillAttached','internalProfit'].includes(a.id)),false);
  h.get('includeIcpInPackage').checked=true;answers=h.run('supplierPreviewAnswers()');
  assert.equal(answers.find(a=>a.id==='icp').value,'000000000AA000A');
});
