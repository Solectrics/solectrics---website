import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/_middleware.js";

test("staging middleware denies unlisted preview aliases before any handler runs",async()=>{
 let called=false;
 const response=await onRequest({request:new Request("https://random.solectrics-jobhub-staging.pages.dev/api/jobs",{method:"POST"}),env:{JOBHUB_STAGING_ONLY:"true",ALLOW_PAGES_DEV_HOST:"true"},next(){called=true;}});
 assert.equal(response.status,403);assert.equal(called,false);
});

test("staging middleware permits the exact Access-protected project hostname",async()=>{
 const response=await onRequest({request:new Request("https://solectrics-jobhub-staging.pages.dev/api/jobs"),env:{JOBHUB_STAGING_ONLY:"true",ALLOW_PAGES_DEV_HOST:"true"},next(){return new Response("staging");}});
 assert.equal(await response.text(),"staging");
});

test("staging middleware permits only the reviewed Operations branch preview hostname",async()=>{
 const response=await onRequest({request:new Request("https://codex-jobhub-solar-operation.solectrics-jobhub-staging.pages.dev/api/jobs"),env:{JOBHUB_STAGING_ONLY:"true",ALLOW_PAGES_DEV_HOST:"true"},next(){return new Response("staging preview");}});
 assert.equal(await response.text(),"staging preview");
});

test("Operations preview hostname remains redirected in production configuration",async()=>{
 const response=await onRequest({request:new Request("https://codex-jobhub-solar-operation.solectrics-jobhub-staging.pages.dev/mini-fergus"),env:{},next(){assert.fail("Unexpected handler");}});
 assert.equal(response.status,308);
 assert.equal(response.headers.get("location"),"https://solectrics.co.nz/mini-fergus");
});

test("existing canonical-host protection remains the default",async()=>{
 const response=await onRequest({request:new Request("https://example.pages.dev/mini-fergus"),env:{},next(){assert.fail("Unexpected handler");}});
 assert.equal(response.status,308);assert.equal(response.headers.get("location"),"https://solectrics.co.nz/mini-fergus");
});
