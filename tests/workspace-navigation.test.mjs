import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../assets/workspace-navigation.js',import.meta.url),'utf8');
const context=vm.createContext({});vm.runInContext(source,context);
const filter=context.WorkspaceNavigation.filteredJobs;
const jobs=[{job_id:1,customer_name:'Synthetic Alpha',address:'Example Road',enquiry_ref:'REF-A',job_type:'solar',job_status:'enquiry'},{job_id:2,customer_name:'Synthetic Beta',address:'Example Lane',enquiry_ref:'REF-B',job_type:'general_electrical',job_status:'completed'}];
test('job search combines customer/address/reference with job type and stored status',()=>{
 assert.equal(filter(jobs,' ALPHA ','solar','enquiry').length,1);
 assert.equal(filter(jobs,'Example','general_electrical','completed')[0].job_id,2);
 assert.equal(filter(jobs,'ref-a','general_electrical').length,0);
 assert.equal(filter(jobs,'2')[0].job_id,2);
 assert.equal(filter(jobs,'unknown').length,0);
 assert.equal(jobs.length,2);
});
test('search tolerates unavailable customer details without inventing records',()=>{
 assert.equal(filter([{job_id:3,job_type:'solar'}],'missing').length,0);
 assert.equal(filter([{job_id:3,job_type:'solar'}],'3').length,1);
});
