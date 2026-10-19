import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const page=await readFile(new URL("../jobhub-staging-test.html",import.meta.url),"utf8");
const script=page.match(/<script>([\s\S]*?)<\/script>/)[1];
function harness(host){
 const elements=new Map(),calls=[];let books=[],jobs=[];
 const context={location:{hostname:host,protocol:"https:"},document:{getElementById(id){if(!elements.has(id))elements.set(id,{hidden:true,disabled:false,textContent:""});return elements.get(id);}},Blob,Intl,Date,
 URL:{createObjectURL(){return "blob:synthetic-test";}},
 async fetch(path,options){
  calls.push({path,options});
  let result;
  if(path==="/api/bookkeeping?view=books")result={ok:true,books};
  else if(path==="/api/jobs"&&!options.method)result={ok:true,jobs};
  else if(path==="/api/bookkeeping"){
   const body=JSON.parse(options.body);assert.equal(body.action,"create_book");assert.equal(body.name,"STAGING TEST BOOK");
   books=[{id:"test-book",name:body.name,gst_basis:body.gst_basis,commencement_date:body.commencement_date}];result={ok:true,book:books[0]};
  }else if(path==="/api/jobs"){
   const body=JSON.parse(options.body);assert.equal(body.customer_name,"STAGING TEST CUSTOMER");
   jobs=[{job_id:1,customer_name:body.customer_name,supplier_reference:"S0001"}];result={ok:true,...jobs[0]};
  }else assert.fail("Unexpected endpoint "+path);
  return {ok:true,async json(){return result;}};
 }};
 vm.createContext(context);vm.runInContext(script,context);
 return {context,elements,calls};
}
test("test helper refuses writes outside the exact staging hostname",async()=>{
 const h=harness("solectrics.co.nz");
 await h.elements.get("prepare").onclick();
 assert.equal(h.calls.length,0);
 assert.match(h.elements.get("status").textContent,/STOP/);
});
test("test helper creates labelled synthetic records once and reuses them",async()=>{
 const h=harness("solectrics-jobhub-staging.pages.dev");
 await h.elements.get("prepare").onclick();
 assert.equal(h.elements.get("next").hidden,false,h.elements.get("status").textContent);
 assert.equal(h.calls.filter(c=>c.options.method==="POST").length,2);
 await h.elements.get("prepare").onclick();
 assert.equal(h.calls.filter(c=>c.options.method==="POST").length,2);
 assert.equal(h.elements.get("job").href,"/mini-fergus-job?id=1");
});
test("synthetic invoice PDF contains the exact test reference and amounts",async()=>{
 const h=harness("solectrics-jobhub-staging.pages.dev");
 const pdf=await h.context.makePdf("S0001","2026-10-06").text();
 assert.ok(pdf.startsWith("%PDF-1.4"));
 assert.match(pdf,/S0001/);assert.match(pdf,/100\.00/);assert.match(pdf,/15\.00/);assert.match(pdf,/115\.00/);
 const offset=Number(pdf.match(/startxref\n(\d+)/)[1]);
 assert.equal(pdf.slice(offset,offset+4),"xref");
});
