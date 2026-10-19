import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../functions/_middleware.js';
import {stagingEnergyEnabled} from '../functions/api/_post-hec-energy.js';
test('recovery preserves production canonical middleware; backup hostname has no runtime allowance',async()=>{
 for(const method of ['GET','POST']) {
 const r=await onRequest({request:new Request('https://codex-jobhub-usability-recovery-backup.solectrics---website.pages.dev/mini-fergus',{method}),env:{JOBHUB_STAGING_ONLY:'true',ALLOW_PAGES_DEV_HOST:'true'},next:()=>new Response('allowed')});
 assert.equal(r.status,method==='GET'?308:404);
 }
 assert.equal(stagingEnergyEnabled({request:new Request('https://solectrics.co.nz/api/job-files'),env:{JOBHUB_STAGING_ONLY:'true',ALLOW_PAGES_DEV_HOST:'true'}}),false);
});
