import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const script=await readFile(new URL('../assets/job-data-review.js',import.meta.url),'utf8');
const page=await readFile(new URL('../mini-fergus-job.html',import.meta.url),'utf8');
const sandbox=vm.createContext({});vm.runInContext(script,sandbox);
const {differences,icpSuggestion}=sandbox.JobDataReview;
test('saved Site Visit differences preserve a reviewed design without mutating source or target',()=>{
 const visit={visit_icp:'meter-b',visit_roof_length:'11.5',visit_trees:false};
 const design={design_icp:'meter-a',design_trees:true,design_reviewed:true,roofs:[{roof_length:'10'}]};
 const before=JSON.stringify({visit,design});const rows=differences(visit,{},design,0);
 assert.equal(rows.length,3);assert.equal(rows.find(r=>r.target==='design_trees').value,false);
 assert.equal(JSON.stringify({visit,design}),before);
});
test('blank and absent source values never propose clearing existing design information',()=>{
 assert.equal(differences({visit_icp:'',visit_supply_notes:null},{panel_count:''},{design_icp:'known',design_supply_notes:'retain',design_panel_count:'20',design_trees:true},null).length,0);
});
test('multiple roofs require an explicit target before any roof value can be proposed',()=>{
 const design={roofs:[{roof_length:'8'},{roof_length:'9'}]};const visit={visit_roof_length:'11.5'};
 assert.equal(differences(visit,{},design,null).length,0);
 assert.equal(differences(visit,{},design,1)[0].target,'roof:1:roof_length');
});
test('assessment equipment differs without replacing the design or silently applying default quantities',()=>{
 const design={design_panel_count:'20',design_panel_wattage:'445'};const rows=differences({}, {panel_count:18,panel_wattage:445},design,null);
 assert.equal(rows.length,1);assert.equal(rows[0].source,'Saved Assessment');assert.equal(design.design_panel_count,'20');
});
test('ICP suggestions use existing values only and fail to guess when HEC/design disagree',()=>{
 assert.equal(icpSuggestion({icp:'A'},{design_icp:'A'}).value,'A');
 assert.equal(icpSuggestion({icp:'A'},{design_icp:'B'}).conflict,true);
 assert.equal(icpSuggestion({icp:'A'},{design_icp:'B'}).value,'');
 assert.equal(icpSuggestion({},{}).value,'');
});
function fn(name,next){const a=page.indexOf('async function '+name+'(');return page.slice(a,next?page.indexOf(next,a):page.indexOf('\n}\n',a)+3);}
test('actual Site Visit save writes only its own record and preserves design',async()=>{
 const writes=[];const message={};
 const context=vm.createContext({siteVisitLoaded:true,jobId:7,loadedSiteVisit:{},hasSavedSiteVisit:false,document:{getElementById:()=>message},collectSiteVisit:()=>({visit_roof_length:'11.5'}),refreshDesignDataReview(){},fetch:async(url,opts)=>{writes.push([url,JSON.parse(opts.body)]);return {ok:true,json:async()=>({ok:true})};},console});
 vm.runInContext(fn('saveSiteVisit'),context);await context.saveSiteVisit();
 assert.equal(writes.length,1);assert.equal(writes[0][0],'/api/site-visit');assert.match(message.textContent,/System Design is unchanged/);
});
test('failed initial loads refuse Site Visit and Design writes',async()=>{
 for(const [name,flag] of [['saveSiteVisit','siteVisitLoaded'],['saveSystemDesign','systemDesignLoaded']]){
 let writes=0;const message={};const context=vm.createContext({[flag]:false,document:{getElementById:()=>message},fetch:async()=>{writes++;},console});
 vm.runInContext(fn(name),context);await context[name]();assert.equal(writes,0);assert.match(message.textContent,/reload/);
 }
});
