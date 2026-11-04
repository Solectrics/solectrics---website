import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const html=readFileSync(new URL("../mini-fergus-job.html",import.meta.url),"utf8");
const backend=readFileSync(new URL("../functions/api/homeowner-review.js",import.meta.url),"utf8");
function fragment(start,end){
  const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"Cannot locate "+start);
  return html.slice(a,b);
}
function demo(){
  const calls=[],fields={
    homeownerReviewQuestions:{innerHTML:""},
    homeownerReviewMessage:{textContent:""},
    homeownerEmailMessage:{textContent:""},
    hr_email_draft:{value:""},
    hr_hot_water_interest:{value:"timer"},
    hr_smart_energy_interest:{value:"yes"},
    hr_tariff_review_interest:{value:"yes"},
    hr_cleaning_interest:{value:"no"},
    hr_hot_water_notes:{value:""},
    hr_other_interests:{value:""},
    hr_homeowner_notes:{value:""}
  };
  const rows=[
    {dataset:{homeownerAnswer:"goals"},value:"Lower my bills"},
    {dataset:{homeownerAnswer:"hotWater"},value:"Electric hot-water cylinder"}
  ];
  const reviewed=[{dataset:{homeownerReviewed:"household"},checked:true}];
  const doc={
    getElementById:id=>fields[id]||null,
    querySelectorAll:q=>q==="[data-homeowner-answer]"?rows:q==="[data-homeowner-reviewed]"?reviewed:[]
  };
  const js=fragment("const homeownerReviewGroups = ","const siteVisitFieldIds = [");
  const code=new Function("currentAnswers","currentJobCustomer","document","scheduleSectionAutosave","escapeHtml","fetch","navigator","console",js+"\nreturn {renderHomeownerReview, collectHomeownerReview, generateHomeownerEmail,saveHomeownerReview,loadHomeownerReview};");
  const api=code(
    {goals:["Lower my bills"],hotWater:"Electric hot-water cylinder",people:"2",bills:{summer:{retailer:"ExamplePower"}}},
    {name:"Demo Customer",email:"demo@example.invalid"},doc,
    event=>calls.push(event.target),
    v=>String(v??"").replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[x])),
    async()=>({ok:true,json:async()=>({ok:true,review:{}})}),
    {clipboard:{writeText:async()=>{}}},
    {error:()=>{}}
  );
  return {api,fields,rows,calls};
}

test("Homeowner Review is a separate solar workspace; original HEC remains intact",()=>{
  assert.ok(html.includes('data-workspace-button="homeowner"'));
  assert.ok(html.includes('id="homeownerReviewSection" data-job-workspace="homeowner"'));
  assert.ok(html.includes('data-job-workspace="hec"'));
  assert.ok(html.includes("All Home Energy Check answers"));
  assert.ok(html.includes('loadHomeownerReview(), loadGeneralJobDetails()'));
  assert.ok(html.includes('["homeowner", saveHomeownerReview, "homeownerReviewMessage"]'));
  const s=fragment('<section class="card solar-only homeowner-review"','<section class="card solar-only" data-job-workspace="design"');
  assert.ok(!s.includes("type=\"submit\""));
});

test("HEC answers render readably, never change their source, and corrections are separate",()=>{
  const x=demo();
  x.api.renderHomeownerReview();
  assert.ok(x.fields.homeownerReviewQuestions.innerHTML.includes("Original HEC:"));
  assert.ok(x.fields.homeownerReviewQuestions.innerHTML.includes("Electric hot-water cylinder"));
  assert.ok(x.fields.homeownerReviewQuestions.innerHTML.includes("Summer"));
  assert.ok(x.fields.homeownerReviewQuestions.innerHTML.includes("ExamplePower"));
  x.rows[0].value="Reduce bills and improve backup";
  const data=x.api.collectHomeownerReview();
  assert.equal(data.corrections.goals,"Reduce bills and improve backup");
  assert.ok(!Object.hasOwn(data.corrections,"hotWater"));
  assert.equal(data.reviewed.household,true);
  assert.equal(data.hot_water_interest,"timer");
});

test("email draft reflects opted-in interests but doesn't send",()=>{
  const x=demo();
  x.api.generateHomeownerEmail();
  const body=x.fields.hr_email_draft.value;
  assert.ok(body.includes("Hi Demo,"));
  assert.ok(body.includes("hot-water timer"));
  assert.ok(body.includes("smart home energy management"));
  assert.ok(body.includes("electricity retailers and tariffs"));
  assert.ok(body.includes("two weeks and one month"));
  assert.ok(body.includes("solar monitoring app"));
  assert.ok(!body.includes("Razor Sharp"));
  assert.equal(x.calls.length,1);
  assert.ok(!html.includes('fetch("/api/send-homeowner-email"'));
});

test("server validates separate review storage and strips unrelated keys",async()=>{
  const mod=new Function(backend.replace(/export async function/g,"async function")+"\nreturn {normalize,onRequestGet,onRequestPost};")();
  const cleaned=mod.normalize({
    corrections:{people:"3",customer_password:"example"},
    reviewed:{household:true,secret:true},
    hot_water_interest:"timer",smart_energy_interest:"yes",
    tariff_review_interest:"yes",aftercare_one_month:true
  });
  assert.deepEqual(cleaned.corrections,{people:"3"});
  assert.deepEqual(cleaned.reviewed,{household:true});
  assert.equal(cleaned.hot_water_interest,"timer");
  assert.equal(cleaned.aftercare_one_month,true);
  assert.equal(mod.normalize({hot_water_interest:"malicious"}).hot_water_interest,"");
  let record=null,sqls=[];
  const db={
    prepare(sql){
      sqls.push(sql);
      return {
        run:async()=>({}),
        bind(...params){
          return {
            first:async()=>sql.startsWith("SELECT id FROM jobs")?{id:1}:
              record?{review_json:record,updated_at:"2026-11-04T00:00:00"}:null,
            run:async()=>{if(sql.includes("INSERT INTO homeowner_reviews"))record=params[1];return{};}
          };
        }
      };
    }
  };
  const request=new Request("https://solectrics.co.nz/api/homeowner-review",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({job_id:1,review:{corrections:{people:"3"},tariff_review_interest:"yes"}})
  });
  const post=await mod.onRequestPost({request,env:{DB:db}});
  assert.equal(post.status,200);
  const get=await mod.onRequestGet({request:new Request("https://solectrics.co.nz/api/homeowner-review?job_id=1"),env:{DB:db}});
  const body=await get.json();
  assert.equal(body.review.corrections.people,"3");
  assert.equal(body.review.tariff_review_interest,"yes");
  assert.ok(!sqls.some(sql=>/UPDATE enquiries|UPDATE jobs/.test(sql)));
  const fail=await mod.onRequestPost({request:new Request("https://solectrics.co.nz/api/homeowner-review",{
    method:"POST",body:JSON.stringify({job_id:0,review:{}})
  }),env:{DB:db}});
  assert.equal(fail.status,400);
});
