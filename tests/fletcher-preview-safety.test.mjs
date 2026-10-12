import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';
import { readFile } from 'node:fs/promises';
const host='fletcher-package-mobile-fix.solectrics-jobhub-staging.pages.dev';
const invoke=(hostname,env={},method='GET')=>onRequest({request:new Request(`https://${hostname}/mini-fergus-fletcher-form.html`,{method}),env,next:()=>new Response('allowed')});
test('exact Fletcher preview needs both true flags; production redirect survives',async()=>{
 assert.equal(await (await invoke(host,{JOBHUB_STAGING_ONLY:'true',ALLOW_PAGES_DEV_HOST:'true'})).text(),'allowed');
 for(const env of [{},{ALLOW_PAGES_DEV_HOST:'true'}]) assert.equal((await invoke(host,env)).status,308);
 assert.equal((await invoke(host,{JOBHUB_STAGING_ONLY:'true'})).status,403);
 assert.equal((await invoke(host,{},'POST')).status,404);
 assert.equal(await (await invoke('solectrics.co.nz')).text(),'allowed');
});
test('staging fails closed for every unapproved hostname and method',async()=>{
 for(const hostname of ['solectrics.co.nz','solectrics-jobhub-staging.pages.dev','other.solectrics-jobhub-staging.pages.dev',host+'.example.test'])
  for(const method of ['GET','POST']) assert.equal((await invoke(hostname,{JOBHUB_STAGING_ONLY:'true',ALLOW_PAGES_DEV_HOST:'true'},method)).status,403);
});
test('deployment wrapper keeps single branch, staging identity checks, and no migrations',async()=>{
 const script=await readFile(new URL('../staging/deploy-fletcher-preview.sh',import.meta.url),'utf8');
 assert.match(script,/codex\/fletcher-package-mobile-fix\)/);
 assert.match(script,/readonly PROJECT='solectrics-jobhub-staging'/);
 assert.match(script,/d1 info "\$DATABASE"/);
 assert.match(script,/DEPLOYMENT_ALIAS='fletcher-package-mobile-fix'/);
 assert.match(script,/--branch "\$DEPLOYMENT_ALIAS"/);
 assert.doesNotMatch(script,/d1 execute|d1 migrations|r2 object|secret put/);
 assert.match(script,/DEPLOY STAGING/);
});
test('dedicated privacy preview is exact and still needs both staging flags',async()=>{
 const privacy='post-hec-bill-fletcher-privacy.solectrics-jobhub-staging.pages.dev';
 assert.equal(await (await invoke(privacy,{JOBHUB_STAGING_ONLY:'true',ALLOW_PAGES_DEV_HOST:'true'})).text(),'allowed');
 assert.equal((await invoke(privacy,{JOBHUB_STAGING_ONLY:'true'})).status,403);
 assert.equal((await invoke(privacy+'.example.test',{JOBHUB_STAGING_ONLY:'true',ALLOW_PAGES_DEV_HOST:'true'})).status,403);
 assert.equal((await invoke(privacy)).status,308);
});
test('dedicated branch uses a separate staging alias without changing resources or remote-tip guard',async()=>{
 const script=await readFile(new URL('../staging/deploy-fletcher-preview.sh',import.meta.url),'utf8');
 assert.match(script,/codex\/post-hec-bill-fletcher-privacy-staging\) DEPLOYMENT_ALIAS='post-hec-bill-fletcher-privacy'/);
 assert.match(script,/git fetch --quiet origin "\$BRANCH"/);
 assert.match(script,/git rev-parse FETCH_HEAD/);
 assert.match(script,/--project-name "\$PROJECT"/);
 assert.doesNotMatch(script,/solectrics---website|secret put|d1 migrations|r2 object/);
});
