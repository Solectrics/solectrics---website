import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../mini-fergus-fletcher-form.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function harness(fetchImpl, files = [{document_role:'roof_layout'}, {document_role:'power_bill'}]) {
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
    fetch: async (url, options) => {events.push(url);if(url.startsWith('/api/job-files?'))return ok({ok:true,files});return fetchImpl(url, options);}
  });
  context.window = context;
  vm.runInContext(script.slice(0, script.indexOf('document.querySelectorAll("input,select,textarea")')), context);
  vm.runInContext('updateMissing = () => [];', context);
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
  assert.match(html,/setChecked\("plansAttached", roles.has\("sld"\) \|\| roles.has\("roof_layout"\)\)/);
  assert.match(html,/setChecked\("powerBillAttached", roles.has\("power_bill"\)\)/);
  assert.doesNotMatch(html,/setChecked\("plansAttached", Boolean\(design/);
});
test('missing layout or power bill stops before PDF save and email',async()=>{
  for(const files of [[],[{document_role:'power_bill'}],[{document_role:'roof_layout'}]]) {
    const h=harness(()=>{throw Error('No write expected');},files);
    await h.run('emailPackage()');
    assert.deepEqual(h.events,['/api/job-files?job_id=7']);
    assert.match(h.get('status').textContent,/Upload these documents/);
  }
});
test('address starts inside the white field rather than on its title',()=>{
  assert.match(html,/drawText\(p1, \$\("siteAddress"\).value, 132, 626, \{ maxWidth:416 \}\)/);
});
