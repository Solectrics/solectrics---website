import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const script=await readFile(new URL('../assets/site-visit-photos.js',import.meta.url),'utf8');
const context=vm.createContext({FormData});vm.runInContext(script,context);
const {contextFor,displayCaption,receiptMatches,sendPhoto}=context.SiteVisitPhotos;
const photo=(state='queued')=>({context:'roof-measurements',file:new Blob(['synthetic photo'],{type:'image/jpeg'}),caption:'[Site visit: roof-measurements] [capture: test-id]',state});
test('site photo context requires explicit caption, category and general role; never becomes OpenSolar layout',()=>{
 assert.equal(contextFor({caption:photo().caption,category:'roof',document_role:'general'}),'roof-measurements');
 assert.equal(contextFor({caption:photo().caption,category:'drawing',document_role:'roof_layout'}),null);
 assert.equal(contextFor({caption:'Roof photo',category:'roof',document_role:'general'}),null);
 assert.equal(contextFor({caption:'[Site visit: inverter-location]',category:'equipment',document_role:'general'}),'inverter-location');
});
test('uploads require only job identity and photo, preserve classification, and saved photos cannot be resent',async()=>{
 const item=photo();let calls=0;
 const request=async(url,{body})=>{calls++;assert.equal(url,'/api/job-files');assert.equal(body.get('job_id'),'7');assert.equal(body.get('category'),'roof');assert.equal(body.get('document_role'),'general');assert.equal(body.get('caption'),item.caption);return {ok:true,json:async()=>({ok:true,id:'saved-id'})};};
 await sendPhoto(item,7,request);await sendPhoto(item,7,request);
 assert.equal(calls,1);assert.equal(item.state,'saved');assert.equal(item.id,'saved-id');
});
test('ambiguous network, authentication or unreadable responses never permit a retry write',async()=>{
 for(const request of [async()=>{throw Error('connection');},async()=>({redirected:true}),async()=>({ok:true,json:async()=>{throw Error('HTML');}}),async()=>({ok:true,json:async()=>({ok:true})})]){
 const item=photo();await sendPhoto(item,7,request);assert.equal(item.state,'unconfirmed');let calls=0;await sendPhoto(item,7,async()=>{calls++;});assert.equal(calls,0);
 }
});
test('an explicit rejection can retry only that photo without re-uploading confirmed saves',async()=>{
 const item=photo();await sendPhoto(item,7,async()=>({ok:false,json:async()=>({ok:false,error:'Rejected'})}));assert.equal(item.state,'failed');
 await sendPhoto(item,7,async()=>({ok:true,json:async()=>({ok:true,id:'recovered'})}));assert.equal(item.state,'saved');
});
test('receipt reconciliation requires exact capture marker rather than filename guesses',()=>{
 const caption=photo().caption;const files=[{id:'a',caption},{id:'b',caption:'[Site visit: roof-measurements] [capture: another-id]'}];assert.equal(receiptMatches(files,caption).length,1);assert.equal(receiptMatches([...files,{id:'c',caption}],caption).length,2);assert.equal(receiptMatches(files,'missing').length,0);
});

test('capture receipt markers stay out of customer-facing document captions',()=>{
 assert.equal(displayCaption({caption:photo().caption,category:'roof',document_role:'general'}),'Roof measurements photograph');
 assert.equal(displayCaption({caption:'Existing unrelated caption',category:'other',document_role:'general'}),'Existing unrelated caption');
});
