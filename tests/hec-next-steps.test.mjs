import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { onRequestPost } from "../functions/api/hec-email-results.js";

const html=await readFile(new URL("../home-energy-check.html",import.meta.url),"utf8");
const mailer=await readFile(new URL("../functions/api/_hec-customer-copy.js",import.meta.url),"utf8");
test("results lead into three choices and then exploring other energy options",()=>{
  assert.match(html,/id="finalVisitCta"/);
  assert.match(html,/id="exploreMore"/);
  assert.match(html,/Explore what <span class="ss-else">ELSE<\/span> is possible/);
  assert.match(html,/id="emailResultsButton"/);
  assert.match(html,/id="sendCheckButton"/);
  assert.match(html,/id="requestVisitButton"/);
  assert.match(html,/actionPanel && controls/);
  assert.match(html,/controls.parentNode.insertBefore\(finalVisitCta,controls\)/);
});
test("requesting a visit records the distinct follow-up intent",()=>{
  assert.match(html,/answers.followUpRequest='free_site_visit'/);
  assert.match(html,/SITE VISIT REQUESTED/);
});
test("email-only uses a distinct API and never calls enquiry endpoint",()=>{
  const a=html.indexOf("async function emailHecResults()");
  const b=html.indexOf("function requestHecVisit()",a);
  const handler=html.slice(a,b);
  assert.match(handler,/\/api\/hec-email-results/);
  assert.doesNotMatch(handler,/\/api\/enquiry/);
  assert.match(mailer,/hecReportSummary/);
});
test("email-only endpoint returns success without a DB binding and includes results",async()=>{
  const originalFetch=globalThis.fetch;
  const emails=[];
  globalThis.fetch=async(url,options)=>{emails.push({url,body:JSON.parse(options.body)});return Response.json({id:"email-test"},{status:200})};
  try{
    const response=await onRequestPost({
      request:new Request("https://example.invalid/api/hec-email-results",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({answers:{email:"someone@example.invalid",name:"Example",
          hecReportSummary:{estimateSource:"household-benchmark",currentAnnualNzd:1800,solarAnnualNzd:623,smartAnnualNzd:533,batteryAnnualNzd:294}}})
      }),
      env:{RESEND_API_KEY:"test-key"}
    });
    assert.equal(response.status,200);
    assert.equal((await response.json()).ok,true);
    assert.equal(emails.length,1);
    assert.equal(emails[0].body.to[0],"someone@example.invalid");
    assert.doesNotMatch(emails[0].body.html,/\$1,800|\$623|\$533|\$294/);
    assert.match(emails[0].body.html,/No sales enquiry or site visit request was created/);
  }finally{globalThis.fetch=originalFetch}
});

test("site-visit enquiry sets the correct next action in Job Hub",async()=>{
  const {onRequestPost:submit}=await import("../functions/api/enquiry.js");
  let id=100;
  const jobs=[];
  const db={prepare(sql){return{bind(...params){this.params=params;return this;},async all(){return{results:[]}},async run(){if(/INSERT INTO jobs/i.test(sql))jobs.push(this.params);return{meta:{last_row_id:++id,changes:1}}}}}};
  const form=new FormData();
  form.append("answers",JSON.stringify({name:"Test Customer",email:"test@example.invalid",followUpRequest:"free_site_visit"}));
  const res=await submit({env:{DB:db},request:new Request("https://example.invalid/api/enquiry",{method:"POST",body:form})});
  assert.equal(res.status,200);
  assert.equal(jobs.length,1);
  assert.equal(jobs[0][2],"Contact customer to arrange free site visit");
});

test("report summary is calculated only after all annual scenario values exist",()=>{
  const recommendation=html.slice(html.indexOf("function recommendation("),html.indexOf("function graph("));
  assert.doesNotMatch(recommendation,/answers\.hecReportSummary/);
  const render=html.slice(html.indexOf("function renderFinalSmartSolarReport()"));
  const current=render.indexOf("const currentAnnual");
  const passive=render.indexOf("const passiveAnnual");
  const smart=render.indexOf("const smartAnnual");
  const battery=render.indexOf("const batteryAnnual");
  const summary=render.indexOf("answers.hecReportSummary=");
  assert.ok(current>=0 && passive>current && smart>passive && battery>smart && summary>battery);
});

test("the detailed smart energy sections remain in the full results template",()=>{
  const template=html.slice(html.indexOf("report.innerHTML = `"),html.indexOf("const finalVisitCta =",html.indexOf("report.innerHTML = `")));
  for(const section of ["Four ways your home could use energy","See the difference across the year","SMARTER TIMING","WINTER ENERGY","SMARTER HOT WATER","ss-battery-section","Three ways forward"]){
    assert.ok(template.includes(section),`Missing report section: ${section}`);
  }
  const summaryIndex=html.indexOf("answers.hecReportSummary=");
  const rendererIndex=html.indexOf("function renderFinalSmartSolarReport()");
  const templateIndex=html.indexOf("report.innerHTML = `",rendererIndex);
  assert.ok(rendererIndex<summaryIndex && summaryIndex<templateIndex,"summary must be calculated inside renderer before template");
});

test("when the customer edits answers, rendering does not delete the three choices or smart sections",()=>{
  const start=html.indexOf("function renderFinalSmartSolarReport()");
  const code=html.slice(start);
  assert.match(code,/old\.contains\(element\)/);
  assert.match(code,/finalScreen\.insertBefore\(element,old\)/);
  assert.match(code,/old\.remove\(\)/);
  assert.match(code,/report\.querySelector\("#sendToSolectrics"\)/);
  assert.match(code,/report\.querySelector\("\.ss-controls-box"\)/);
});
test("sending a review cannot inherit a previous unsent site visit request",()=>{
  assert.match(html,/function sendHecReview\(\)/);
  assert.match(html,/answers\.followUpRequest='review'/);
  assert.match(html,/function requestHecVisit\(\)/);
});

test("site visit copy includes roof, switchboard, meter and hot water",()=>{
  assert.match(html,/Your answers allow us to assess which system would suit you best\./);
  assert.match(html,/free home visit to understand your roof, switchboard, meter, hot-water system/);
});
test("only one email-results choice exists, without a duplicate checkbox",()=>{
  assert.equal(html.split('id="emailResultsButton"').length-1,1);
  assert.doesNotMatch(html,/id="customerCopyConsent"/);
  assert.match(html,/answers\.customerCopyOptIn = false;/);
});

test("no-bill results do not present speculative annual costs or savings",()=>{
  const report=html.slice(html.indexOf("function renderFinalSmartSolarReport()"));
  assert.match(report,/!model\.financialEstimateReady \? `/);
  assert.match(report,/id="noBillEstimateNotice"/);
  assert.match(report,/We are not displaying dollar savings until/);
  assert.match(report,/Confirmed during assessment/);
  assert.match(html,/id="exploreMore"/);
  assert.match(html,/Explore what <span class="ss-else">ELSE<\/span> is possible/);
});

test("results offer bespoke site visits, not generic price links",()=>{
  const resultScreen=html.slice(html.indexOf('id="resultScreen"'),html.indexOf('const PERSONAS='));
  assert.doesNotMatch(resultScreen,/SEE SMART SOLAR PRICES|Want to explore the costs\?|href="\/smart-solar-prices"/);
  assert.match(resultScreen,/free home visit/);
  assert.match(resultScreen,/free home visit to understand your roof, switchboard, meter, hot-water system/);
});

test("bill-supplied forecasts remain hidden until tax and tariff assumptions are verified",()=>{
  const model=html.slice(html.indexOf("function buildModel()"),html.indexOf("function annual("));
  assert.match(model,/financialEstimateReady:\s*false/);
  const report=html.slice(html.indexOf("function renderFinalSmartSolarReport()"));
  assert.match(report,/!model\.financialEstimateReady \? `/);
  assert.match(report,/financialEstimateReady:model\.financialEstimateReady/);
  assert.match(mailer,/financialEstimateReady === true/);
});

test("winter cost table is gated until financial estimates are verified",()=>{
  const report=html.slice(html.indexOf("function renderFinalSmartSolarReport()"));
  const winter=report.slice(report.indexOf("Winter energy options")-180,report.indexOf("Winter energy options")+5500);
  assert.match(winter,/model\.financialEstimateReady \? /);
  assert.match(winter,/Dollar comparisons are paused/);
  assert.match(winter,/winterMoney\(winter\.sameNoBattery\)/);
});
