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
    assert.match(emails[0].body.html,/\$1,800/);
    assert.match(emails[0].body.html,/No sales enquiry or site visit request was created/);
  }finally{globalThis.fetch=originalFetch}
});
