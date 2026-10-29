import test from 'node:test';import assert from 'node:assert/strict';import {syntheticDb}from './helpers/synthetic-db.mjs';import {onRequestPost}from '../functions/api/enquiry.js';import {onRequestGet as download}from '../functions/api/job-file.js';
for(const fail of ['none','second-object','job-insert'])test(`synthetic SQLite/R2 retention and rollback: ${fail}`,async()=>{
 const {db,sql}=syntheticDb(),objects=new Map([['existing-original',Buffer.from('existing')]]);let puts=0;
 sql.prepare('INSERT INTO enquiries(id,enquiry_ref,answers_json) VALUES(?,?,?)').run(10,'synthetic-existing','{"retain":true}');sql.prepare('INSERT INTO jobs(id,enquiry_id) VALUES(?,?)').run(20,10);
 const guarded={prepare(query){const st=db.prepare(query);if(fail==='job-insert'&&query.includes('INSERT INTO jobs'))return {bind(){return {async run(){throw Error('Synthetic failure');}};}};return st;}};
 const bucket={async put(key,bytes){objects.set(key,Buffer.from(bytes));if(++puts===2&&fail==='second-object')throw Error('Synthetic failure');},async delete(key){assert.notEqual(key,'existing-original');objects.delete(key);},async get(key){return {body:objects.get(key),writeHttpMetadata(){}};}};
 const env={DB:guarded,JOB_FILES:bucket};const form=new FormData();form.set('answers',JSON.stringify({name:'Synthetic',followUpRequest:'free_site_visit',energyDataUploads:{recentBills:[{name:'forged.pdf'}]}}));
 for(const season of ['summer','winter'])form.set(season+'_bill',new File([season+' original bytes'],season+'.pdf',{type:'application/pdf'}));
 const res=await onRequestPost({request:new Request('http://localhost/api/enquiry',{method:'POST',body:form}),env});assert.equal(res.status,fail==='none'?200:500);
 assert.equal(sql.prepare('SELECT answers_json FROM enquiries WHERE id=10').get().answers_json,'{"retain":true}');assert.deepEqual(objects.get('existing-original'),Buffer.from('existing'));
 assert.equal(sql.prepare('SELECT count(*) n FROM enquiries').get().n,fail==='none'?2:1);assert.equal(sql.prepare('SELECT count(*) n FROM jobs').get().n,fail==='none'?2:1);
 if(fail==='none'){
  const data=await res.json();assert.equal(data.attachmentCount,2);const saved=JSON.parse(sql.prepare('SELECT answers_json FROM enquiries WHERE id=?').get(data.enquiryRef).answers_json);assert.equal(saved.attachmentManifest.length,2);assert.equal(saved.energyDataUploads.recentBills[0].name,'summer.pdf');
  for(const [i,row]of sql.prepare('SELECT * FROM job_files ORDER BY rowid').all().entries()){const result=await download({request:new Request('http://localhost/api/job-file?id='+row.id),env});assert.equal(await result.text(),['summer','winter'][i]+' original bytes');}
 }else assert.equal(objects.size,1);
});
