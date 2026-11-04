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
  const calls=[],requests=[],copied=[],fields={
    homeownerReviewQuestions:{innerHTML:""},
    homeownerReviewMessage:{textContent:""},
    homeownerEmailMessage:{textContent:""},
    homeownerEmailState:{textContent:""},
    homeownerEmailRecipient:{textContent:""},
    hr_email_draft:{value:""},
    hr_email_reviewed:{checked:false},
    hr_hot_water_interest:{value:"timer"},
    hr_smart_energy_interest:{value:"yes"},
    hr_tariff_review_interest:{value:"yes"},
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
  const code=new Function("currentAnswers","currentJobCustomer","document","scheduleSectionAutosave","escapeHtml","fetch","navigator","console","window",js+"\nreturn {renderHomeownerReview, collectHomeownerReview, generateHomeownerEmail,saveHomeownerReview,loadHomeownerReview,copyHomeownerEmail,setEditedForTest:value=>{homeownerEmailEdited=value},getEditedForTest:()=>homeownerEmailEdited};");
  const api=code(
    {goals:["Lower my bills"],hotWater:"Electric hot-water cylinder",people:"2",bills:{summer:{retailer:"ExamplePower"}}},
    {name:"Demo Customer",email:"demo@example.invalid"},doc,
    event=>calls.push(event.target),
    v=>String(v??"").replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[x])),
    async(uri,options={})=>{
      if(options.body)requests.push(JSON.parse(options.body));
      const review=options.body?JSON.parse(options.body).review:{};
      return {ok:true,json:async()=>({ok:true,review})};
    },
    {clipboard:{writeText:async value=>{copied.push(value)}}},
    {error:()=>{}},
    {confirm:()=>true}
  );
  return {api,fields,rows,calls,requests,copied};
}

test("Homeowner Review is a separate solar workspace; original HEC remains intact",()=>{
  assert.ok(html.includes('data-workspace-button="homeowner"'));
  assert.ok(html.includes('id="homeownerReviewSection" data-job-workspace="homeowner"'));
  assert.ok(html.includes('data-job-workspace="hec"'));
  assert.ok(html.includes("All Home Energy Check answers"));
  assert.ok(html.includes('loadHomeownerReview(), loadGeneralJobDetails()'));
  assert.ok(html.includes('["homeowner", saveHomeownerReview, "homeownerReviewMessage"]'));
  assert.ok(html.includes('["homeowner", saveHomeownerReview, "homeownerEmailMessage"]'));
  assert.ok(html.includes('id="homeownerEmailOfficeSection" data-job-workspace="office"'));
  assert.ok(html.indexOf('id="homeownerEmailOfficeSection"')<html.indexOf('id="officeFundingSection"'));
  assert.ok(html.indexOf('id="hr_email_draft"')>html.indexOf('id="homeownerEmailOfficeSection"'));
  assert.ok(!html.includes('Prepare email draft</button>'));
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
  x.fields.hr_hot_water_interest.value="timer";
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
  assert.ok(!html.includes('id="hr_cleaning_interest"'));
  assert.ok(html.includes('id="hr_aftercare_cleaning"'));
  assert.equal(x.calls.length,1);
  assert.ok(!html.includes('fetch("/api/send-homeowner-email"'));
});


test("saving Tom's conversation automatically drafts email in Office without sending",async()=>{
  const x=demo();
  assert.equal(x.fields.hr_email_draft.value,"");
  const ok=await x.api.saveHomeownerReview();
  assert.equal(ok,true);
  assert.equal(x.requests.length,1);
  assert.equal(x.requests[0].review.email_draft,x.fields.hr_email_draft.value);
  assert.ok(x.fields.hr_email_draft.value.includes("smart home energy management"));
  assert.ok(x.fields.hr_email_draft.value.includes("electricity retailers and tariffs"));
  assert.equal(x.requests[0].review.email_draft_edited,false);
  assert.equal(x.requests[0].review.email_draft_reviewed,false);
  assert.ok(x.fields.homeownerEmailState.textContent.includes("Automatic draft ready"));
  assert.equal(x.copied.length,0);
  assert.ok(!html.includes("sendHomeownerEmail("));
});
test("office edits survive new homeowner answers and require review before copy",async()=>{
  const x=demo();
  await x.api.saveHomeownerReview();
  x.fields.hr_email_draft.value+="\\nPersonal note from the office.";
  x.api.setEditedForTest(true);
  x.fields.hr_email_reviewed.checked=false;
  x.fields.hr_smart_energy_interest.value="no";
  await x.api.saveHomeownerReview();
  const updated=x.requests.at(-1).review;
  assert.ok(updated.email_draft.endsWith("Personal note from the office."));
  assert.equal(updated.email_draft_edited,true);
  assert.ok(updated.email_draft.includes("smart home energy management")); // preserved, not regenerated
  await x.api.copyHomeownerEmail();
  assert.equal(x.copied.length,0);
  assert.ok(x.fields.homeownerEmailMessage.textContent.includes("review"));
  x.fields.hr_email_reviewed.checked=true;
  await x.api.saveHomeownerReview();
  assert.equal(x.requests.at(-1).review.email_draft_reviewed,true);
  await x.api.copyHomeownerEmail();
  assert.equal(x.copied.length,1);
  assert.ok(x.copied[0].includes("Personal note"));
});
test("updated homeowner interests refresh only automatically generated drafts and revoke earlier approval",async()=>{
  const x=demo();
  await x.api.saveHomeownerReview();
  const before=x.fields.hr_email_draft.value;
  x.fields.hr_email_reviewed.checked=true;
  x.fields.hr_smart_energy_interest.value="no";
  await x.api.saveHomeownerReview();
  const after=x.fields.hr_email_draft.value;
  assert.ok(before.includes("smart home energy management"));
  assert.ok(!after.includes("We'll also share information about smart home energy management"));
  assert.equal(x.fields.hr_email_reviewed.checked,false);
  assert.equal(x.requests.at(-1).review.email_draft_reviewed,false);
  assert.equal(x.requests.at(-1).review.email_draft_edited,false);
});
\ntest("server validates separate review storage and strips unrelated keys",async()=>{
  const mod=new Function(backend.replace(/export async function/g,"async function")+"\nreturn {normalize,onRequestGet,onRequestPost};")();
  const cleaned=mod.normalize({
    corrections:{people:"3",customer_password:"example"},
    reviewed:{household:true,secret:true},
    hot_water_interest:"timer",smart_energy_interest:"yes",
    tariff_review_interest:"yes",aftercare_one_month:true,
    email_draft_edited:true,email_draft_reviewed:true
  });
  assert.deepEqual(cleaned.corrections,{people:"3"});
  assert.deepEqual(cleaned.reviewed,{household:true});
  assert.equal(cleaned.hot_water_interest,"timer");
  assert.equal(cleaned.aftercare_one_month,true);
  assert.equal(cleaned.email_draft_edited,true);
  assert.equal(cleaned.email_draft_reviewed,true);
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
    body:JSON.stringify({job_id:1,review:{corrections:{people:"3"},tariff_review_interest:"yes",email_draft:"Email ready",email_draft_edited:true,email_draft_reviewed:true}})
  });
  const post=await mod.onRequestPost({request,env:{DB:db}});
  assert.equal(post.status,200);
  const get=await mod.onRequestGet({request:new Request("https://solectrics.co.nz/api/homeowner-review?job_id=1"),env:{DB:db}});
  const body=await get.json();
  assert.equal(body.review.corrections.people,"3");
  assert.equal(body.review.tariff_review_interest,"yes");
  assert.equal(body.review.email_draft,"Email ready");
  assert.equal(body.review.email_draft_edited,true);
  assert.equal(body.review.email_draft_reviewed,true);
  assert.ok(!sqls.some(sql=>/UPDATE enquiries|UPDATE jobs/.test(sql)));
  const fail=await mod.onRequestPost({request:new Request("https://solectrics.co.nz/api/homeowner-review",{
    method:"POST",body:JSON.stringify({job_id:0,review:{}})
  }),env:{DB:db}});
  assert.equal(fail.status,400);
});
